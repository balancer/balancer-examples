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
  printGas,
} from '@balancer-examples/shared-dependencies';
import {
  Vault,
  WeightedPoolFactory,
  WeightedPoolFactory__factory,
  WeightedPool__factory,
} from '@balancer-labs/typechain';

import {
  WeightedPoolEncoder,
  toNormalizedWeights,
  SwapKind,
  FundManagement,
  SingleSwap,
  BatchSwapStep,
} from '@balancer-labs/balancer-js';
import { expect } from 'chai';

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
  const poolTokens = pickTokenAddresses(tokens, 4);
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

  const userData = WeightedPoolEncoder.joinInit(poolTokens.map(() => tokenAmount));

  const joinRequest = {
    assets: poolTokens,
    maxAmountsIn: poolTokens.map(() => MaxUint256),
    userData,
    fromInternalBalance: false,
  };

  await txConfirmation(vault.connect(trader).joinPool(poolId, trader.address, trader.address, joinRequest));

  // Single swap
  const amount = parseFixed('5', 18);
  const singleSwap: SingleSwap = {
    poolId,
    kind: SwapKind.GivenIn,
    assetIn: poolTokens[0],
    assetOut: poolTokens[2],
    amount,
    userData: '0x',
  };

  const funds: FundManagement = {
    sender: trader.address,
    fromInternalBalance: false,
    recipient: trader.address,
    toInternalBalance: false,
  };

  const limit = 0;
  const deadline = MaxUint256;

  const { balances } = await vault.getPoolTokens(poolId);

  console.log(`Before the swap, the pool holds:`);
  poolTokens.forEach((token, i) => {
    console.log(`  ${token}: ${formatFixed(balances[i], 18)}`);
  });
  console.log('\n');

  // We are doing a swap given in, so the balance of token 0 will go up by amount,
  // and the balance of token 2 will go down (by amount - swap fee)

  let tx = await txConfirmation(vault.connect(trader).swap(singleSwap, funds, limit, deadline));
  console.log(`${printGas(tx.gasUsed)} (single swap)\n`);

  // Get balances after swap
  const afterSwap = await vault.getPoolTokens(poolId);

  console.log(`After the swap, the pool holds:`);
  poolTokens.forEach((token, i) => {
    console.log(`  ${token}: ${formatFixed(afterSwap.balances[i], 18)}`);
  });
  console.log('\n');

  expect(afterSwap.balances[0]).to.equal(balances[0].add(amount));
  expect(afterSwap.balances[1]).to.eq(balances[1]);
  expect(afterSwap.balances[2]).to.gt(balances[2].sub(amount));

  // Now do a batch swap (would normally be across multiple pools)

  const step1: BatchSwapStep = {
    poolId,
    assetInIndex: 0,
    assetOutIndex: 1,
    amount,
    userData: '0x',
  };

  const step2: BatchSwapStep = {
    poolId,
    assetInIndex: 1,
    assetOutIndex: 3,
    amount: 0,
    userData: '0x',
  };

  const swaps = [step1, step2];
  const limits = poolTokens.map(() => parseFixed('1000', 18));

  tx = await txConfirmation(
    vault.connect(trader).batchSwap(SwapKind.GivenIn, swaps, poolTokens, funds, limits, deadline)
  );
  console.log(`${printGas(tx.gasUsed)} (batch swap)\n`);

  const afterBatchSwap = await vault.getPoolTokens(poolId);

  console.log(`After the batch swap, the pool holds:`);
  poolTokens.forEach((token, i) => {
    console.log(`  ${token}: ${formatFixed(afterBatchSwap.balances[i], 18)}`);
  });
  console.log('\n');

  expect(afterBatchSwap.balances[0]).to.equal(balances[0].add(amount.mul(2)));
  expect(afterBatchSwap.balances[1]).to.eq(balances[1]);
  expect(afterBatchSwap.balances[2]).to.gt(balances[2].sub(amount));
  expect(afterBatchSwap.balances[3]).to.gt(balances[3].sub(amount));
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
