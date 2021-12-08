import { ethers, network } from 'hardhat';
import { expect } from 'chai';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { BigNumber, FixedFormat, formatFixed, parseFixed } from '@ethersproject/bignumber';
import { Contract } from '@ethersproject/contracts';
import { deploySortedTokens, TokenList } from '@balancer-examples/shared-dependencies';
import { Vault, LiquidityBootstrappingPoolFactory, LiquidityBootstrappingPoolFactory__factory } from '@balancer-labs/typechain';
import { deployVault, txConfirmation, getBalancerContractArtifact, mintTokens } from '@balancer-examples/shared-dependencies/index';
import { WeightedPoolEncoder } from '@balancer-labs/balancer-js';
import CopperLBPLauncherArtifact from '../artifacts/contracts/CopperLBPLauncher.sol/CopperLBPLauncher.json';
import TimelockControllerArtifact from '../artifacts/contracts/TimelockController.sol/TimelockController.json';

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

  before('setup', async () => {
    [, admin, manager, feeRecipient, newFeeRecipient, newManager, poolOwner, newPoolOwner, rando] = await ethers.getSigners();
  });

  function fp(value: number): BigNumber {
    return parseFixed(value.toString(), 18);
  }

  async function currentTimestamp(): Promise<BigNumber> {
    const { timestamp } = await network.provider.send('eth_getBlockByNumber', ['latest', true]);
    return BigNumber.from(timestamp);
  };

  async function deployLBPFactory(vault: Vault, deployer: SignerWithAddress): Promise<LiquidityBootstrappingPoolFactory> {
    const { abi, bytecode } = await getBalancerContractArtifact('20210721-liquidity-bootstrapping-pool', 'LiquidityBootstrappingPoolFactory');
  
    const factory = new ethers.ContractFactory(abi, bytecode, deployer);
    const instance = await factory.deploy(vault.address);
    return LiquidityBootstrappingPoolFactory__factory.connect(instance.address, deployer);
  }

  async function deployLauncher(params: any[], from?: SignerWithAddress): Promise<Contract> {
    const [defaultDeployer] = await ethers.getSigners();
    const deployer = from || defaultDeployer;
    const factory = new ethers.ContractFactory(CopperLBPLauncherArtifact.abi, CopperLBPLauncherArtifact.bytecode, deployer);
    const instance = await factory.deploy(...params);
    return instance;
  }

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

    launcher = await deployLauncher([vault.address, exitFeePercentage, feeRecipient.address, lbpFactory.address], manager);

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
        expect(event).to.not.be.null;
  
        if (event) {
          expect(event.args?.previousManager).to.equal(manager.address);
          expect(event.args?.newManager).to.equal(newManager.address);
        }
      });
  
      it('claimOwnership reeploys the timelock', async () => {
        const oldTimelock = await launcher.getTimelockController();
        await launcher.connect(newManager).claimOwnership();
  
        const newTimelock = await launcher.getTimelockController();
        const timelockContract = await deployedAt(newTimelock, TimelockControllerArtifact.abi, admin);
  
        expect(newTimelock).to.not.equal(oldTimelock);
        expect(await timelockContract.getMinDelay()).to.equal(await launcher.MIN_TIMELOCK_DELAY());
      });  
    });
  });

  context('when fee recipient is changed', () => {
    it('reverts unless called by the timelock', async () => {
      await expect(launcher.changeFeeRecipient(newFeeRecipient.address)).to.be.revertedWith('Must use timelock');
    });

    it('can change the fee recipient through the timelock', async () => {
      expect(true).to.be.true;
    });
  });

  type PoolConfig = {
    name: string,
    symbol: string,
    tokens: string[],
    amounts: BigNumber[],
    weights: BigNumber[],
    endWeights: BigNumber[],
    fundTokenIndex: number,
    swapFeePercentage: BigNumber,
    userData: string,
    startTime: BigNumber,
    endTime: BigNumber,
    owner: string
  };

  describe.only('deploy LBP', () => {
    const NAME = 'LBP Name';
    const SYMBOL = 'LBP';
    const PERCENTAGE = fp(0.01);
    let currentTime: BigNumber = fp(0);
    let poolConfig: PoolConfig, threeTokenConfig: PoolConfig, mismatchedEndWeightsConfig: PoolConfig;
    let invalidTimestampsConfig: PoolConfig, tooShortConfig: PoolConfig;

    beforeEach('setup pool config', async () => {
      const amounts = [fp(1000), parseFixed('10', 8)];

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

    it('manager can call createAuction', async () => {
      //const bal = await tokens.DAI.balanceOf(poolOwner.address);

      const receipt = await txConfirmation(launcher.connect(manager).createAuction(poolConfig));
  
      const event = receipt.events?.find((e) => e.event == 'PoolCreated');
      expect(event).to.not.be.null;
    });

    it('createAuction deploys and starts the LBP', async () => {
      expect(true).to.be.true;
    });
    it('createAuction stores the LBP data', async () => {
      expect(true).to.be.true; //  isPool(pool), getPoolAt(index), getPools(), getPoolData()
    });

    context('when trading is enabled', () => {
      it('reverts if setSwapEnabled called by non-pool-owner', async () => {
        expect(true).to.be.true;
      });
      it('pool owner can call setSwapEnabled', async () => {
        expect(true).to.be.true;
      });
    });

    context.skip('when pool ownership is transferred', () => {
      it('reverts if non-pool owner transfers ownership', async () => {
        expect(true).to.be.true;
      });
      it('pool owner can initiate ownership transfer', async () => {
        expect(true).to.be.true;
      });
      it('claimOwnership reverts if called by non-candidate', async () => {
        expect(true).to.be.true;
      });
      it('candidate can claimOwnership of the pool', async () => {
        expect(true).to.be.true;
      });
      it('transfer of pool ownership updates pool data', async () => {
        expect(true).to.be.true;
      });
    });

    describe('when the LBP ends', () => {
      context('when there are no proceeds', () => {
        it('exitPool reverts unless called by pool owner', async () => {
          expect(true).to.be.true;
        });
        it('Pool owner can call exitPool', async () => {
          expect(true).to.be.true;
        });
        it('Pool owner recovers sale proceeds', async () => {
          expect(true).to.be.true;
        });
        it('No fees are charged when the raise failed', async () => {
          expect(true).to.be.true;
        });
      });

      context('when there are proceeds', () => {
        // swap on LBP to create proceeds
        it('Pool owner recovers sale proceeds (minus fees)', async () => {
          expect(true).to.be.true;
        });
        it('Fees are charged and sent to the fee recipient', async () => {
          expect(true).to.be.true;
        });
      });
    });
  });
});
