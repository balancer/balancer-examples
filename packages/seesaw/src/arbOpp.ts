import { WeightedPoolPairData } from './pools/weightedPool/weightedPool';
import { _spotPriceAfterSwapTokenInForExactTokenOut } from './pools/weightedPool/weightedMath';
import { PoolState, PoolTypes } from './types';
import { BatchSwapStep } from '@balancer-labs/balancer-js';
import { BigNumber, formatFixed, FixedNumber } from '@ethersproject/bignumber';
import { parseUnits } from '@ethersproject/units';
import { fromFp, fp, fromFpDecimals } from './numbers'
import { Decimal } from 'decimal.js';

const SCALE = parseUnits('1');

function multiplyFP(a: BigNumber, b: BigNumber): BigNumber {
  return a.mul(b).div(SCALE);
}

function divideFP(a: BigNumber, b: BigNumber): BigNumber {
  return a.mul(SCALE).div(b);
}

export function getSpotPrice(pairData: WeightedPoolPairData): Decimal {
  const swapFeeComplement = new Decimal(1).sub(pairData.swapFee);
  const balanceOverWeightIn = pairData.balanceIn.div(pairData.weightIn);

  const balanceOverWeightOut = pairData.balanceOut.div(pairData.weightOut);

  return balanceOverWeightOut.div(balanceOverWeightIn).div(swapFeeComplement);
}

export function getAmountInForSpotPriceAfterSwapNoFees(pairData: WeightedPoolPairData, desiredSpotPrice: Decimal): Decimal {
  let spotPrice: Decimal = getSpotPrice(pairData);
  console.log('Spot price, desired spot price', spotPrice, desiredSpotPrice);

  const exponent = pairData.weightOut.div(pairData.weightIn.add(pairData.weightOut)).sub(new Decimal(1));
  return pairData.balanceIn.mul(
    desiredSpotPrice.div(spotPrice).pow(exponent)
  );
}

function poolPairData(pool: PoolState, inputTokenIndex, outputTokenIndex): WeightedPoolPairData {
  const poolType = PoolTypes.Weighted;
  return {
    id: pool.id,
    address: pool.address,
    swapFee: fromFp(pool.swapFee),
    poolType,
    tokenIn: pool.tokens[inputTokenIndex],
    decimalsIn: 18, // TODO
    balanceIn: fromFpDecimals(pool.balances[inputTokenIndex], 18), // TODO
    weightIn: fromFp(pool.weights[inputTokenIndex]),
    tokenOut: pool.tokens[outputTokenIndex],
    balanceOut: fromFpDecimals(pool.balances[outputTokenIndex], 18),
    decimalsOut: 18, // TODO
    weightOut: fromFp(pool.weights[outputTokenIndex]),
  };
}

function getExtraAmountIn(
  p: WeightedPoolPairData,
  currentSpotPrice: Decimal,
  amountIn: Decimal,
  desiredSpotPrice: Decimal
): Decimal {
  const swapFeeComplement = new Decimal('1').sub(p.swapFee)
  return 
  swapFeeComplement
    .mul(amountIn)
    .add(p.balanceIn)
    .mul(desiredSpotPrice.sub(currentSpotPrice))
    .div(
      currentSpotPrice.mul(
        p.swapFee
        .mul(p.balanceIn)
        .div(amountIn.add(p.balanceIn))
        .add(swapFeeComplement)
        .mul(p.weightIn.div(p.weightOut).add(1))
      )
    )
}

export function getAmountInForSpotPrice(
  pair: WeightedPoolPairData,
  desiredSpotPrice: Decimal,
  numIterations: number
) {
  let amountIn = getAmountInForSpotPriceAfterSwapNoFees(pair, desiredSpotPrice);
  let spotPriceAfter = _spotPriceAfterSwapTokenInForExactTokenOut(amountIn, pair);
  // iterate to find the amount in that maximizes the profit
  for (let i; i < numIterations; i++) {
    let extraAmountIn = getExtraAmountIn(pair, spotPriceAfter, amountIn, desiredSpotPrice);
    amountIn = amountIn.add(extraAmountIn);
    spotPriceAfter = _spotPriceAfterSwapTokenInForExactTokenOut(amountIn, pair);
  }
  return amountIn;
}

export function identifyArbitrageOpp(marketPrices: { [key: string]: number }, poolState: PoolState, poolTokens: string[]): BatchSwapStep[] {
  const assetInIndex = 0; // TODO
  const assetOutIndex = 1; // TODO

  const weightedPoolPairData = poolPairData(poolState, assetInIndex, assetOutIndex);
  const NUM_ITERATIONS = 10;

  //console.log(marketPrices);
 
  const desiredSpotPrice = new Decimal(
    (marketPrices[weightedPoolPairData.tokenIn] / marketPrices[weightedPoolPairData.tokenOut]).toString()
  );
  const amount = getAmountInForSpotPrice(weightedPoolPairData, desiredSpotPrice, NUM_ITERATIONS);

  // determine how much
  const arb: BatchSwapStep = {
    poolId: poolState.id,
    assetInIndex,
    assetOutIndex,
    //amount: fp(amount), // TODO
    amount: fp(new Decimal('.01')),
    userData: '0x',
  };
  return [arb];
}
