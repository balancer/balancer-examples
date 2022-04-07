import { expect } from 'chai';
import { ethers } from 'hardhat';
import { Vault } from '@balancer-labs/typechain';

import {
  TokenList,
  setupEnvironment,
  pickTokenAddresses,
  txConfirmation,
} from '@balancer-examples/shared-dependencies';
import { fp } from '@balancer-examples/shared-dependencies/numbers';
import { toNormalizedWeights, FundManagement, BatchSwapStep, SwapKind } from '@balancer-labs/balancer-js';
import { Contract } from '@ethersproject/contracts';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { WeightedPoolEncoder } from '@balancer-labs/balancer-js';

import { MaxUint256 } from '@ethersproject/constants';

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

const tokenAmount = fp(100);
const tokenExitAmount = fp(10);

describe('CharityPool', function () {
  let vault: Vault;
  let tokens: TokenList;
  let tokenAddresses: string[];
  let deployer: SignerWithAddress;
  let liquidityProvider: SignerWithAddress;
  let charity: SignerWithAddress;
  let trader: SignerWithAddress;
  let poolId: string;

  const POOL_SWAP_FEE_PERCENTAGE = fp(0.01);
  const WEIGHTS = toNormalizedWeights([fp(30), fp(70)]);

  beforeEach('deploy tokens', async () => {
    ({ vault, tokens, deployer, trader, liquidityProvider } = await setupEnvironment());
    [, , , , , charity] = await ethers.getSigners();
    tokenAddresses = pickTokenAddresses(tokens, 2);
  });

  async function deployCharityPool(params: unknown[]): Promise<Contract> {
    const CharityPool = await ethers.getContractFactory('CharityPool');
    const charityPool = await CharityPool.deploy(params);
    const instance: Contract = await charityPool.deployed();
    return instance;
  }

  context(`with a pool containing WETH and DAI tokens`, () => {
    let pool: Contract;

    beforeEach('deploy pool', async () => {
      const params = [
        vault.address,
        'test pool',
        'TEST',
        tokenAddresses,
        WEIGHTS,
        [ZERO_ADDRESS, ZERO_ADDRESS],
        POOL_SWAP_FEE_PERCENTAGE,
        100,
        100,
        deployer.address,
        charity.address
      ];

      pool = await deployCharityPool(params);
      poolId = await pool.getPoolId();
    });

    context('when pool has been initialized', () => {
      beforeEach('initialize pool', async () => {
        const userData = WeightedPoolEncoder.joinInit(tokenAddresses.map(() => tokenAmount));

        const joinRequest = {
          assets: tokenAddresses,
          maxAmountsIn: tokenAddresses.map(() => MaxUint256),
          userData,
          fromInternalBalance: false,
        };

        await txConfirmation(
          vault
          .connect(liquidityProvider)
          .joinPool(poolId, liquidityProvider.address, liquidityProvider.address, joinRequest)
        );
      });

      it('collects swap fees as bpt when a swap happens', async () => {
        const amount = fp(5);
        const funds: FundManagement = {
          sender: trader.address,
          fromInternalBalance: false,
          recipient: trader.address,
          toInternalBalance: false,
        };

        const deadline = MaxUint256;

        const step1: BatchSwapStep = {
          poolId,
          assetInIndex: 0,
          assetOutIndex: 1,
          amount,
          userData: '0x',
        };

        const swaps = [step1];
        const limits = tokenAddresses.map(() => fp(1000));
        await txConfirmation(
          vault.connect(trader).batchSwap(SwapKind.GivenIn, swaps, tokenAddresses, funds, limits, deadline)
        );

        expect(await pool.balanceOf(pool.address)).to.be.gt(0)
      });

      context('after a swap has happened', () => {
        beforeEach('swap', async () => {
          const amount = fp(5);
          const funds: FundManagement = {
            sender: trader.address,
            fromInternalBalance: false,
            recipient: trader.address,
            toInternalBalance: false,
          };

          const deadline = MaxUint256;

          const step1: BatchSwapStep = {
            poolId,
            assetInIndex: 0,
            assetOutIndex: 1,
            amount,
            userData: '0x',
          };

          const swaps = [step1];
          const limits = tokenAddresses.map(() => fp(1000));
          await txConfirmation(
            vault.connect(trader).batchSwap(SwapKind.GivenIn, swaps, tokenAddresses, funds, limits, deadline)
          );
        })

        it('allows anyone to payout to the charity', async () => {
          await pool.payoutToCharity();
          expect(await tokens.DAI.balanceOf(charity.address)).to.be.gt(0)
        })
      })
    });
  });
});
