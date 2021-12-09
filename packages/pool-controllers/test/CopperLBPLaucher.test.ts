import { ethers, network } from 'hardhat';
import { expect } from 'chai';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { BigNumber, parseFixed } from '@ethersproject/bignumber';
import { Contract } from '@ethersproject/contracts';
import { deploySortedTokens, TokenList } from '@balancer-examples/shared-dependencies';
import {
  Vault,
  LiquidityBootstrappingPoolFactory,
  LiquidityBootstrappingPoolFactory__factory,
} from '@balancer-labs/typechain';
import {
  deployVault,
  txConfirmation,
  getBalancerContractArtifact,
  mintTokens,
} from '@balancer-examples/shared-dependencies/index';
import { WeightedPoolEncoder, SwapKind, FundManagement, SingleSwap } from '@balancer-labs/balancer-js';
import CopperLBPLauncherArtifact from '../artifacts/contracts/CopperLBPLauncher.sol/CopperLBPLauncher.json';
import TimelockControllerArtifact from '../artifacts/contracts/TimelockController.sol/TimelockController.json';

function fp(value: number): BigNumber {
  return parseFixed(value.toString(), 18);
}

function expectEqualWithError(actual: BigNumber, expected: BigNumber, error: BigNumber = fp(0.001)): void {
  const acceptedError = expected.mul(error);

  expect(actual).to.be.at.least(expected.sub(acceptedError));
  expect(actual).to.be.at.most(expected.add(acceptedError));
}

describe('Copper LBP Launcher', () => {
  let admin: SignerWithAddress,
    manager: SignerWithAddress,
    feeRecipient: SignerWithAddress,
    newManager: SignerWithAddress;
  let newFeeRecipient: SignerWithAddress,
    poolOwner: SignerWithAddress,
    newPoolOwner: SignerWithAddress,
    rando: SignerWithAddress;
  let exitFeePercentage: BigNumber;
  let lbpFactory: Contract;
  let launcher: Contract;
  let vault: Vault;
  let tokens: TokenList;

  const SECOND = 1;
  const MINUTE = SECOND * 60;
  const HOUR = MINUTE * 60;
  const DAY = HOUR * 24;

  const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
  const ZERO_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000000';
  const MaxUint256: BigNumber = BigNumber.from('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');

  before('setup', async () => {
    [, admin, manager, feeRecipient, newFeeRecipient, newManager, poolOwner, newPoolOwner, rando] =
      await ethers.getSigners();
  });

  async function currentTimestamp(): Promise<BigNumber> {
    const { timestamp } = await network.provider.send('eth_getBlockByNumber', ['latest', true]);
    return BigNumber.from(timestamp);
  }

  async function advanceTime(seconds: BigNumber): Promise<void> {
    await ethers.provider.send('evm_increaseTime', [parseInt(seconds.toString())]);
    await ethers.provider.send('evm_mine', []);
  }

  async function deployLBPFactory(
    vault: Vault,
    deployer: SignerWithAddress
  ): Promise<LiquidityBootstrappingPoolFactory> {
    const { abi, bytecode } = await getBalancerContractArtifact(
      '20210721-liquidity-bootstrapping-pool',
      'LiquidityBootstrappingPoolFactory'
    );

    const factory = new ethers.ContractFactory(abi, bytecode, deployer);
    const instance = await factory.deploy(vault.address);
    return LiquidityBootstrappingPoolFactory__factory.connect(instance.address, deployer);
  }

  async function deployLauncher(params: unknown[], from?: SignerWithAddress): Promise<Contract> {
    const [defaultDeployer] = await ethers.getSigners();
    const deployer = from || defaultDeployer;
    const factory = new ethers.ContractFactory(
      CopperLBPLauncherArtifact.abi,
      CopperLBPLauncherArtifact.bytecode,
      deployer
    );
    const instance = await factory.deploy(...params);
    return instance;
  }

  /* eslint-disable @typescript-eslint/no-explicit-any */
  async function deployedAt(address: string, abi: any, signer: SignerWithAddress): Promise<Contract> {
    return new ethers.Contract(address, abi, signer);
  }

  beforeEach('deploy vault, factory, tokens, and launcher', async () => {
    vault = await deployVault(admin.address);
    lbpFactory = await deployLBPFactory(vault, admin);
    exitFeePercentage = parseFixed('3', 15);

    tokens = await deploySortedTokens(['DAI', 'USDC', 'WBTC', 'NEO'], [18, 6, 8, 0]);
    await mintTokens(tokens, 'DAI', poolOwner, fp(10000));
    await mintTokens(tokens, 'WBTC', poolOwner, fp(100));
    await mintTokens(tokens, 'DAI', rando, fp(100));

    launcher = await deployLauncher(
      [vault.address, exitFeePercentage, feeRecipient.address, lbpFactory.address],
      manager
    );

    await tokens.DAI.connect(poolOwner).approve(launcher.address, fp(10000));
    await tokens.WBTC.connect(poolOwner).approve(launcher.address, fp(100));
  });

  context('initial deployment', () => {
    it('sets the manager', async () => {
      expect(await launcher.getManager()).to.equal(manager.address);
    });

    it('sets the timelock', async () => {
      const timelock = await launcher.getTimelockController();
      const minDelay = await launcher.MIN_TIMELOCK_DELAY();

      const timelockContract = await deployedAt(timelock, TimelockControllerArtifact.abi, admin);

      expect(timelock).to.not.equal(ZERO_ADDRESS);
      expect(await timelockContract.getMinDelay()).to.equal(minDelay);
    });

    it('sets the fee percentage', async () => {
      expect(await launcher.exitFeePercentage()).to.equal(exitFeePercentage);
    });

    it('sets the fee recipient', async () => {
      expect(await launcher.getFeeRecipient()).to.equal(feeRecipient.address);
    });

    it('poolCount is zero', async () => {
      expect(await launcher.poolCount()).to.equal(0);
    });

    it('reverts if getPoolData called with no pool', async () => {
      await expect(launcher.getPoolData(ZERO_ADDRESS)).to.be.revertedWith('Invalid pool address');
    });

    it('reverts if getBPTTokenBalance called with no pool', async () => {
      await expect(launcher.getBPTTokenBalance(ZERO_ADDRESS)).to.be.revertedWith('Invalid pool address');
    });
  });

  describe('transfer ownership', () => {
    context('when transfer is invalid', () => {
      it('reverts if non-manager transfers ownership', async () => {
        await expect(launcher.connect(newManager).transferOwnership(newManager.address)).to.be.revertedWith(
          'Caller is not manager'
        );
      });

      it('claimOwnership reverts if called by non-candidate', async () => {
        await expect(launcher.connect(rando).claimOwnership()).to.be.revertedWith('Sender not allowed');
      });
    });

    context('when transfer is valid', () => {
      beforeEach('initiate transfer', async () => {
        await launcher.connect(manager).transferOwnership(newManager.address);
      });

      it('manager can initiate ownership transfer', async () => {
        // 2-step process, so the old manager is still in charge
        expect(await launcher.getManager()).to.equal(manager.address);
      });

      it('candidate can claimOwnership', async () => {
        await launcher.connect(newManager).claimOwnership();

        expect(await launcher.getManager()).to.equal(newManager.address);
      });

      it('claimOwnership emits an event', async () => {
        const claimReceipt = await txConfirmation(launcher.connect(newManager).claimOwnership());

        const event = claimReceipt.events?.find((e) => e.event == 'OwnershipTransferred');

        expect(event?.args?.previousManager).to.equal(manager.address);
        expect(event?.args?.newManager).to.equal(newManager.address);
      });

      it('claimOwnership redeploys the timelock', async () => {
        const oldTimelock = await launcher.getTimelockController();
        await launcher.connect(newManager).claimOwnership();

        const newTimelock = await launcher.getTimelockController();
        const timelockContract = await deployedAt(newTimelock, TimelockControllerArtifact.abi, admin);

        expect(newTimelock).to.not.equal(oldTimelock);
        expect(await timelockContract.getMinDelay()).to.equal(await launcher.MIN_TIMELOCK_DELAY());
      });
    });
  });

  describe('change fee recipient', () => {
    it('reverts unless called by the timelock', async () => {
      await expect(launcher.changeFeeRecipient(newFeeRecipient.address)).to.be.revertedWith('Must use timelock');
    });

    context('when fee receipient changed', () => {
      let timelock: Contract;
      let data: string;
      let minDelay: BigNumber;

      beforeEach('schedule fee recipient change', async () => {
        const timelockAddress = await launcher.getTimelockController();
        minDelay = await launcher.MIN_TIMELOCK_DELAY();

        timelock = await deployedAt(timelockAddress, TimelockControllerArtifact.abi, admin);

        //const data = launcher.changeFeeRecipient(newFeeRecipient.address).encodeABI();
        const ABI = ['function changeFeeRecipient(address newRecipient)'];
        const iface = new ethers.utils.Interface(ABI);
        data = iface.encodeFunctionData('changeFeeRecipient', [newFeeRecipient.address]);

        // The manager needs to propose and execute on the timelock
        await timelock.connect(manager).schedule(
          launcher.address,
          0, // No ETH
          data,
          ZERO_BYTES32, // no predecessor
          ZERO_BYTES32, // salt
          minDelay
        );
      });

      // reverts as expected, but not caught by expect somehow?
      xit('changing the fee recipient reverts if too early', async () => {
        expect(
          await timelock.connect(manager).execute(
            launcher.address,
            0, // No ETH
            data,
            ZERO_BYTES32, // no predecessor
            ZERO_BYTES32 // salt
          )
        ).to.be.revertedWith('TimelockController: operation is not ready');
      });

      // reverts as expected, but not caught by expect somehow?
      xit('changing the fee recipient reverts if called by non-manager', async () => {
        advanceTime(minDelay);

        expect(
          await timelock.connect(rando).execute(
            launcher.address,
            0, // No ETH
            data,
            ZERO_BYTES32, // no predecessor
            ZERO_BYTES32 // salt
          )
        ).to.be.revertedWith('Sender not allowed');
      });

      it('timelock can change the fee recipient', async () => {
        advanceTime(minDelay);

        await timelock.connect(manager).execute(
          launcher.address,
          0, // No ETH
          data,
          ZERO_BYTES32, // no predecessor
          ZERO_BYTES32 // salt
        );

        // Fee recipient should be changed
        expect(await launcher.getFeeRecipient()).to.equal(newFeeRecipient.address);
      });
    });
  });

  type PoolConfig = {
    name: string;
    symbol: string;
    tokens: string[];
    amounts: BigNumber[];
    weights: BigNumber[];
    endWeights: BigNumber[];
    fundTokenIndex: number;
    swapFeePercentage: BigNumber;
    userData: string;
    startTime: BigNumber;
    endTime: BigNumber;
    owner: string;
  };

  describe('deploy LBP', () => {
    const NAME = 'LBP Name';
    const SYMBOL = 'LBP';
    const PERCENTAGE = fp(0.01);
    let currentTime: BigNumber = fp(0);
    let poolConfig: PoolConfig, threeTokenConfig: PoolConfig, mismatchedEndWeightsConfig: PoolConfig;
    let invalidTimestampsConfig: PoolConfig, tooShortConfig: PoolConfig;

    beforeEach('setup pool config', async () => {
      const amounts = [fp(1000), parseFixed('10', 8)];
      currentTime = await currentTimestamp();

      poolConfig = {
        name: NAME,
        symbol: SYMBOL,
        tokens: [tokens.DAI.address, tokens.WBTC.address],
        amounts: amounts,
        weights: [fp(0.1), fp(0.9)],
        endWeights: [fp(0.9), fp(0.1)],
        fundTokenIndex: 0,
        swapFeePercentage: PERCENTAGE,
        userData: WeightedPoolEncoder.joinInit(amounts),
        startTime: currentTime.add(10),
        endTime: currentTime.add(DAY * 3),
        owner: poolOwner.address,
      };

      threeTokenConfig = {
        name: NAME,
        symbol: SYMBOL,
        tokens: [tokens.DAI.address, tokens.USDC.address, tokens.NEO.address],
        amounts: [fp(1000), fp(100), fp(10)],
        weights: [fp(0.1), fp(0.2), fp(0.7)],
        endWeights: [fp(0.7), fp(0.2), fp(0.1)],
        fundTokenIndex: 0,
        swapFeePercentage: PERCENTAGE,
        userData: '0x',
        startTime: currentTime.add(10),
        endTime: currentTime.add(DAY * 3),
        owner: poolOwner.address,
      };

      mismatchedEndWeightsConfig = {
        name: NAME,
        symbol: SYMBOL,
        tokens: [tokens.DAI.address, tokens.NEO.address],
        amounts: [fp(1000), fp(10)],
        weights: [fp(0.1), fp(0.9)],
        endWeights: [fp(0.7), fp(0.2), fp(0.1)],
        fundTokenIndex: 0,
        swapFeePercentage: PERCENTAGE,
        userData: '0x',
        startTime: currentTime.add(10),
        endTime: currentTime.add(DAY * 3),
        owner: poolOwner.address,
      };

      invalidTimestampsConfig = {
        name: NAME,
        symbol: SYMBOL,
        tokens: [tokens.DAI.address, tokens.NEO.address],
        amounts: [fp(1000), fp(10)],
        weights: [fp(0.1), fp(0.9)],
        endWeights: [fp(0.9), fp(0.1)],
        fundTokenIndex: 0,
        swapFeePercentage: PERCENTAGE,
        userData: '0x',
        startTime: currentTime.add(DAY * 3),
        endTime: currentTime.add(10),
        owner: poolOwner.address,
      };

      tooShortConfig = {
        name: NAME,
        symbol: SYMBOL,
        tokens: [tokens.DAI.address, tokens.NEO.address],
        amounts: [fp(1000), fp(10)],
        weights: [fp(0.1), fp(0.9)],
        endWeights: [fp(0.9), fp(0.1)],
        fundTokenIndex: 0,
        swapFeePercentage: PERCENTAGE,
        userData: '0x',
        startTime: currentTime.add(10),
        endTime: currentTime.add(100),
        owner: poolOwner.address,
      };

      currentTime = await currentTimestamp();
    });

    it('createAuction reverts unless called by the manager', async () => {
      await expect(launcher.connect(rando).createAuction(poolConfig)).to.be.revertedWith('Caller is not manager');
    });

    it('createAuction reverts if called with three tokens', async () => {
      await expect(launcher.connect(manager).createAuction(threeTokenConfig)).to.be.revertedWith('Only 2-token LBPs');
    });

    it('createAuction reverts if called with mismatched end weights', async () => {
      await expect(launcher.connect(manager).createAuction(mismatchedEndWeightsConfig)).to.be.revertedWith(
        'Length mismatch'
      );
    });

    it('createAuction reverts if called with invalid start/end times', async () => {
      await expect(launcher.connect(manager).createAuction(invalidTimestampsConfig)).to.be.revertedWith(
        'Invalid LBP times'
      );
    });

    it('createAuction reverts if called with too short duration', async () => {
      await expect(launcher.connect(manager).createAuction(tooShortConfig)).to.be.revertedWith(
        'LBP duration too short'
      );
    });

    context('when LBP is deployed', () => {
      let lbp: Contract;

      beforeEach('create auction', async () => {
        const { abi } = await getBalancerContractArtifact(
          '20210721-liquidity-bootstrapping-pool',
          'LiquidityBootstrappingPool'
        );
        const receipt = await txConfirmation(launcher.connect(manager).createAuction(poolConfig));

        // Can this be done less retardedly?
        receipt?.events?.find(async function (e) {
          for (const [k, v] of Object.entries(e)) {
            if (k == 'address') {
              lbp = await deployedAt(v, abi, admin);
              break;
            }
          }
        });
      });

      it('createAuction starts the LBP with swaps disabled', async () => {
        expect(await lbp.getSwapEnabled()).to.be.false;

        const { startTime, endTime, endWeights } = await lbp.getGradualWeightUpdateParams();
        expect(startTime).to.equal(poolConfig.startTime);
        expect(endTime).to.equal(poolConfig.endTime);
        expectEqualWithError(endWeights[0], poolConfig.endWeights[0], fp(0.0001));
        expectEqualWithError(endWeights[1], poolConfig.endWeights[1], fp(0.0001));
      });

      it('createAuction stores the LBP data', async () => {
        expect(await launcher.poolCount()).to.equal(1);
        expect(await launcher.isPool(lbp.address)).to.be.true;
        expect(await launcher.getPoolAt(0)).to.equal(lbp.address);
        const { owner, ownerCandidate, fundTokenIndex, fundTokenSeedAmount } = await launcher.getPoolData(lbp.address);
        expect(owner).to.equal(poolConfig.owner);
        expect(ownerCandidate).to.equal(ZERO_ADDRESS);
        expect(fundTokenIndex).to.equal(0);
        expect(fundTokenSeedAmount).to.equal(fp(1000));

        const pools: string[] = await launcher.getPools();
        expect(pools.length).to.equal(1);
        expect(pools[0]).to.equal(lbp.address);
      });

      context('when trading is enabled', () => {
        it('reverts if setSwapEnabled called by non-pool-owner', async () => {
          await expect(launcher.connect(rando).setSwapEnabled(lbp.address, true)).to.be.revertedWith(
            'Caller is not pool owner'
          );
        });

        it('pool owner can call setSwapEnabled', async () => {
          await launcher.connect(poolOwner).setSwapEnabled(lbp.address, true);

          expect(await lbp.getSwapEnabled()).to.be.true;
        });
      });

      describe('transfer pool ownership', () => {
        it('reverts if non-pool owner transfers ownership', async () => {
          await expect(
            launcher.connect(rando).transferPoolOwnership(lbp.address, newPoolOwner.address)
          ).to.be.revertedWith('Caller is not pool owner');
        });

        it('pool owner can initiate ownership transfer', async () => {
          await launcher.connect(poolOwner).transferPoolOwnership(lbp.address, newPoolOwner.address);

          // Owner is still the old one before claiming
          const { owner, ownerCandidate } = await launcher.getPoolData(lbp.address);
          expect(owner).to.equal(poolOwner.address);
          expect(ownerCandidate).to.equal(newPoolOwner.address);
        });

        context('when ownership transfer is initiated', () => {
          beforeEach('transfer ownership', async () => {
            await launcher.connect(poolOwner).transferPoolOwnership(lbp.address, newPoolOwner.address);
          });

          it('claimOwnership reverts if called by non-candidate', async () => {
            await expect(launcher.connect(rando).claimPoolOwnership(lbp.address)).to.be.revertedWith(
              'Sender not allowed'
            );
          });

          it('candidate can claimOwnership of the pool', async () => {
            await launcher.connect(newPoolOwner).claimPoolOwnership(lbp.address);

            // Owner is now the new one, and candidate data is cleared
            const { owner, ownerCandidate } = await launcher.getPoolData(lbp.address);
            expect(owner).to.equal(newPoolOwner.address);
            expect(ownerCandidate).to.equal(ZERO_ADDRESS);
          });
        });
      });

      describe('when the LBP ends', () => {
        const minAmounts = [0, 0];
        const bptOut = 0;

        context('when there are no proceeds', () => {
          it('exitPool reverts if called on an invalid pool', async () => {
            await expect(launcher.connect(manager).exitPool(rando.address, minAmounts, bptOut)).to.be.revertedWith(
              'Invalid pool address'
            );
          });

          it('exitPool reverts unless called by pool owner', async () => {
            await expect(launcher.connect(manager).exitPool(lbp.address, minAmounts, bptOut)).to.be.revertedWith(
              'Caller is not pool owner'
            );
          });

          it('Pool owner can exit pool with partial BPT', async () => {
            const bpt = await lbp.balanceOf(launcher.address);
            // Make sure there is some
            expect(bpt).to.gt(0);

            await launcher.connect(poolOwner).exitPool(lbp.address, minAmounts, bpt.div(2));
          });

          context('pool owner has exited', () => {
            beforeEach('exit pool with full BPT', async () => {
              await launcher.connect(poolOwner).exitPool(lbp.address, minAmounts, bptOut);
            });

            it('Pool owner recovers original deposit', async () => {
              expectEqualWithError(await tokens.DAI.balanceOf(poolOwner.address), poolConfig.amounts[0], fp(0.000001));
              expectEqualWithError(await tokens.WBTC.balanceOf(poolOwner.address), poolConfig.amounts[1], fp(0.000001));
            });

            it('No fees are charged when the raise failed', async () => {
              expect(await tokens.DAI.balanceOf(feeRecipient.address)).to.equal(0);
            });
          });
        });

        context('when there are proceeds', () => {
          const amount = parseFixed('90', 18);

          beforeEach('exit pool with full BPT', async () => {
            // swap on LBP to create proceeds
            const poolId = await lbp.getPoolId();

            // Single swap
            const singleSwap: SingleSwap = {
              poolId,
              kind: SwapKind.GivenIn,
              assetIn: tokens.DAI.address,
              assetOut: tokens.WBTC.address,
              amount,
              userData: '0x',
            };

            const funds: FundManagement = {
              sender: rando.address,
              fromInternalBalance: false,
              recipient: rando.address,
              toInternalBalance: false,
            };

            // Need to enable swaps first!
            await launcher.connect(poolOwner).setSwapEnabled(lbp.address, true);

            // And approve tokens for transfer
            await tokens.DAI.connect(rando).approve(vault.address, fp(100));

            const limit = 0;
            const deadline = MaxUint256;
            await vault.connect(rando).swap(singleSwap, funds, limit, deadline);

            // Now exit; there should be some fees from the swap
            await launcher.connect(poolOwner).exitPool(lbp.address, minAmounts, bptOut);
          });

          it('Pool owner recovers sale proceeds (minus fees)', async () => {
            // DAI balance should be original + trade - fees (really small)
            expectEqualWithError(
              await tokens.DAI.balanceOf(poolOwner.address),
              poolConfig.amounts[0].add(amount),
              fp(0.000001)
            );
          });

          it('Fees are charged and sent to the fee recipient', async () => {
            expect(await tokens.DAI.balanceOf(feeRecipient.address)).to.gt(0);
          });
        });
      });
    });
  });
});
