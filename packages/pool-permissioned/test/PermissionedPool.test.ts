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

describe('PermissionedPool', function () {
  let vault: Vault;
  let tokens: TokenList;
  let tokenAddresses: string[];
  let deployer: SignerWithAddress;
  let liquidityProvider: SignerWithAddress;
  let trader: SignerWithAddress;
  let poolId: string;

  const allowlistId = '0x0000000000000000000000000000000000000000000000000000000000000001';

  const POOL_SWAP_FEE_PERCENTAGE = fp(0.01);
  const WEIGHTS = toNormalizedWeights([fp(30), fp(70)]);

  beforeEach('deploy tokens', async () => {
    ({ vault, tokens, deployer, trader, liquidityProvider } = await setupEnvironment());
    tokenAddresses = pickTokenAddresses(tokens, 2);
  });

  async function deployPermissionedRegistry(): Promise<Contract> {
    const PermissionedRegistry = await ethers.getContractFactory('PermissionedRegistry');
    const permissionedRegistry = await PermissionedRegistry.deploy();
    const instance: Contract = await permissionedRegistry.deployed();
    return instance;
  }

  async function deployPermissionedPool(params: unknown[]): Promise<Contract> {
    const PermissionedPool = await ethers.getContractFactory('PermissionedPool');
    const permissionedPool = await PermissionedPool.deploy(params);
    const instance: Contract = await permissionedPool.deployed();
    return instance;
  }

  describe('weights and scaling factors', () => {
    context(`with WETH and DAI tokens`, () => {
      let pool: Contract;
      let registry: Contract;

      beforeEach('deploy pool', async () => {
        // TODO
        registry = await deployPermissionedRegistry();
        await registry.createAllowlist(allowlistId);

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
          registry.address,
          allowlistId,
        ];

        pool = await deployPermissionedPool(params);
        poolId = await pool.getPoolId();
      });

      it('reverts when an unapproved LP attempts to join', () => {
        const userData = WeightedPoolEncoder.joinInit(tokenAddresses.map(() => tokenAmount));

        const joinRequest = {
          assets: tokenAddresses,
          maxAmountsIn: tokenAddresses.map(() => MaxUint256),
          userData,
          fromInternalBalance: false,
        };

        expect(
          vault
            .connect(liquidityProvider)
            .joinPool(poolId, liquidityProvider.address, liquidityProvider.address, joinRequest)
        ).to.be.revertedWith('account is not allowlisted');
      });

      context('when a LP has been allowlisted', () => {
        beforeEach('allowlist LP', async () => {
          await registry.addAllowedAddress(allowlistId, liquidityProvider.address);
        });

        it('allows an approved LP to join', async () => {
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

          it('allows trader to swap when approved', async () => {
            await registry.addAllowedAddress(allowlistId, trader.address);

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
          });

          it('reverts when trader is approved and then unapproved', async () => {
            await registry.addAllowedAddress(allowlistId, trader.address);
            await registry.removeAllowedAddress(allowlistId, trader.address);

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
            await expect(
              vault.connect(trader).batchSwap(SwapKind.GivenIn, swaps, tokenAddresses, funds, limits, deadline)
            ).to.be.revertedWith('Swap not allowed');
          });

          it('reverts when trader is unapproved', async () => {
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
            await expect(
              vault.connect(trader).batchSwap(SwapKind.GivenIn, swaps, tokenAddresses, funds, limits, deadline)
            ).to.be.revertedWith('Swap not allowed');
          });

          it('allows an approved LP to exit', async () => {
            const userData = WeightedPoolEncoder.exitBPTInForExactTokensOut(
              tokenAddresses.map(() => tokenExitAmount),
              MaxUint256
            );

            const exitRequest = {
              assets: tokenAddresses,
              minAmountsOut: tokenAddresses.map(() => fp(0)),
              userData,
              toInternalBalance: false,
            };

            await txConfirmation(
              vault
                .connect(liquidityProvider)
                .exitPool(poolId, liquidityProvider.address, liquidityProvider.address, exitRequest)
            );
          });

          it('reverts when a previously approved but now disallowed LP tries to exit', async () => {
            await registry.removeAllowedAddress(allowlistId, trader.address);

            const userData = WeightedPoolEncoder.exitBPTInForExactTokensOut(
              tokenAddresses.map(() => tokenExitAmount),
              MaxUint256
            );

            const exitRequest = {
              assets: tokenAddresses,
              minAmountsOut: tokenAddresses.map(() => fp(0)),
              userData,
              toInternalBalance: false,
            };

            await txConfirmation(
              vault
                .connect(liquidityProvider)
                .exitPool(poolId, liquidityProvider.address, liquidityProvider.address, exitRequest)
            );
          });
        });
      });
    });
  });
});
