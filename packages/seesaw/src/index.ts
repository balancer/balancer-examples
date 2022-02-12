import { ethers } from 'hardhat';
//import { Contract } from "@ethersproject/contracts";
import { Vault, WeightedPool } from '@balancer-labs/typechain';
import {
  TokenList,
  setupEnvironment,
  mintTokens,
  pickTokenAddresses
} from '@balancer-examples/shared-dependencies';
import { BigNumber } from '@ethersproject/bignumber';
import { MaxUint256 } from '@ethersproject/constants';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { WeightedPoolPairData } from './pools/weightedPool/weightedPool';

import { argv } from 'yargs';
import { PoolState } from './types';
import { HistoricalPrices, HistoricalPriceSnapshot, getHistoricalPriceData } from './priceProvider';
import { identifyArbitrageOpp } from './arbOpp';
import { deployWeightedPoolFactory, deployWeightedPool, initializeWeightedPool } from './testbench';

let vault: Vault;
let tokens: TokenList;
let trader: SignerWithAddress;

// historical block provider

async function getPoolState(pool: WeightedPool): Promise<PoolState> {
  const poolId = await pool.getPoolId();
  const { tokens, balances } = await vault.getPoolTokens(poolId);
  const swapFee = await pool.getSwapFeePercentage();
  const weights = await pool.getNormalizedWeights();

  return {
    id: poolId,
    address: pool.address,
    swapFee,
    weights,
    tokens,
    balances,
  };
}

// onBlock hook
async function onBlock(
  vault: Vault,
  pool: WeightedPool,
  //blockNumber: number,
  marketPrices: { [key: string]: number}
) {
  const arbs = [];
  //const marketPrices: HistoricalPrice[] = getPrices(blockNumber, tokens);
  let poolState = await getPoolState(pool);
  const arb = identifyArbitrageOpp(marketPrices, poolState);
  arbs.push(arb);

  // TODO execute arbs
}

async function main() {
  ({ vault, tokens, trader } = await setupEnvironment());


  const poolTokens = pickTokenAddresses(tokens,2);
  for (const symbol in tokens) {
    await mintTokens(tokens, symbol, trader, 200e18);
    await tokens[symbol].connect(trader).approve(vault.address, MaxUint256);
  }

  const weightedPoolFactory = await deployWeightedPoolFactory(vault, trader);
  console.log(`Successfully deployed PoolFactory! 🎉\n`);

  const pool = await deployWeightedPool(weightedPoolFactory, poolTokens, trader);
  const poolId = await pool.getPoolId();
  console.log(`Successfully deployed Pool! 🎉\n`);

  const coingeckoTokenNames = ['balancer', 'ethereum'];
  const priceData: HistoricalPrices = await getHistoricalPriceData(coingeckoTokenNames, poolTokens);

  const initialTimestamp = Object.keys(priceData)[0]
  const initialPriceData = priceData[initialTimestamp]
  await initializeWeightedPool(poolId, vault, pool, trader, initialPriceData);
  console.log(`Successfully initialized Pool! 🎉\n`);


  for (const timestamp in priceData) {
    await onBlock(vault, pool, priceData[timestamp]);
  }
  return;
}

main();
