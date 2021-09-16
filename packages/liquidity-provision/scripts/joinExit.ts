import { ethers } from 'hardhat';
import { formatFixed, parseFixed } from '@ethersproject/bignumber';
import { MaxUint256, One } from '@ethersproject/constants';

import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';

import {
  TokenList,
  pickTokenAddresses,
  setupEnvironment,
  txConfirmation,
  getBalancerContractArtifact,
} from '@balancer-examples/shared-dependencies';
import {
  Vault,
  WeightedPoolFactory,
  WeightedPoolFactory__factory,
  WeightedPool__factory,
} from '@balancer-labs/typechain';

import { WeightedPoolEncoder, toNormalizedWeights } from '@balancer-labs/balancer-js';

// setup environment
const tokenAmount = parseFixed('100', 18);

let vault: Vault;
let tokens: TokenList;
let trader: SignerWithAddress;

async function main() {
  /**
   * First we need to deploy the Vault and any tokens we're going to use
   */
  ({ vault, tokens, trader } = await setupEnvironment());

  /**
   * We need to have a pool for us to add liquidity to
   * Balancer Pools are deployed from factories so let's deploy a factory for Weighted Pools.
   */
  const weightedPoolFactory = await deployWeightedPoolFactory(vault, trader);
  console.log(`Successfully deployed WeightedPoolFactory! 🎉\n`);

  /**
   * Now we can deploy our WeightedPool from the factory contract
   * Try changing some of the pool's settings!
   */
  const name = 'My New Balancer Pool';
  const symbol = 'POOL';
  const poolTokens = pickTokenAddresses(tokens, 2);
  const normalizedWeights = toNormalizedWeights(poolTokens.map(() => One));
  const swapFeePercentage = parseFixed('1', 12);
  const delegateOwner = '0xBA1BA1ba1BA1bA1bA1Ba1BA1ba1BA1bA1ba1ba1B';
  const deploymentReceipt = await txConfirmation(
    weightedPoolFactory.create(name, symbol, poolTokens, normalizedWeights, swapFeePercentage, delegateOwner)
  );

  const event = deploymentReceipt.events?.find((e) => e.event == 'PoolCreated');
  if (event == undefined) {
    throw new Error('Could not find PoolCreated event');
  }
  const pool = WeightedPool__factory.connect(event.args?.pool, trader);
  const poolId = await pool.getPoolId();

  console.log(`Successfully deployed ${await pool.name()} to ${pool.address}! 🎉\n`);

  /**
   * Balancer pools are deployed in an uninitialized state.
   * Before anyone can trade with them, we need to add some initial liquidity.
   * This gives the pool some tokens to give to traders and sets the initial prices.
   */

  let userData = WeightedPoolEncoder.joinInit(poolTokens.map(() => tokenAmount));

  const joinRequest = {
    assets: poolTokens,
    maxAmountsIn: poolTokens.map(() => MaxUint256),
    userData,
    fromInternalBalance: false,
  };

  await txConfirmation(vault.connect(trader).joinPool(poolId, trader.address, trader.address, joinRequest));

  /**
   * Let's just do a quick check to see what's happened.
   * We can check the pool's balances on the vault to look at the tokens we've added and also see how much BPT we received in return
   */

  const { balances } = await vault.getPoolTokens(poolId);
  console.log(`The pool now holds:`);
  poolTokens.forEach((token, i) => {
    console.log(`  ${token}: ${formatFixed(balances[i], 18)}`);
  });
  console.log('\n');

  let bpt = await pool.balanceOf(trader.address);
  console.log(`I received ${formatFixed(bpt, 18)} ${symbol} (BPT) in return`);

  console.log('\n');

  /*
   * We can now burn the BPT to exit the pool, recovering the initial investment. Note that the totalSupply will not be exactly zero:
   * pools always mint a "minimum BPT" value to the zero address so that pools cannot be completely drained. (This helps keep the
   * weighted math well behaved, and avoids the gas cost of enforcing minimum balances.)
   *
   */

  userData = WeightedPoolEncoder.exitExactBPTInForTokensOut(bpt);

  const exitRequest = {
    assets: poolTokens,
    minAmountsOut: poolTokens.map(() => 0),
    userData,
    toInternalBalance: false,
  };

  await txConfirmation(vault.connect(trader).exitPool(poolId, trader.address, trader.address, exitRequest));

  bpt = await pool.balanceOf(trader.address);
  console.log(`I have ${formatFixed(bpt, 18)} ${symbol} (BPT) left after exiting`);

  const tokenResult = await vault.getPoolTokens(poolId);
  console.log(`The pool now holds:`);
  poolTokens.forEach((token, i) => {
    console.log(`  ${token}: ${formatFixed(tokenResult.balances[i], 18)}`);
  });
  console.log('\n');

  const totalSupply = await pool.totalSupply();
  console.log(`The pool total supply is now: ${formatFixed(totalSupply, 18)}`);
}

async function deployWeightedPoolFactory(vault: Vault, deployer: SignerWithAddress): Promise<WeightedPoolFactory> {
  const { abi, bytecode } = await getBalancerContractArtifact('20210418-weighted-pool', 'WeightedPoolFactory');

  const factory = new ethers.ContractFactory(abi, bytecode, deployer);
  const instance = await factory.deploy(vault.address);
  return WeightedPoolFactory__factory.connect(instance.address, deployer);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
