import { WeightedPoolPairData } from './pools/weightedPool/weightedPool';
import { _spotPriceAfterSwapTokenInForExactTokenOut } from './pools/weightedPool/weightedMath';
import { PoolState, PoolTypes } from './types';
import { BatchSwapStep } from '@balancer-labs/balancer-js';
import { BigNumber, formatFixed, FixedNumber } from '@ethersproject/bignumber';
import { parseUnits } from '@ethersproject/units';
import { fromFp, fp, fromFpDecimals } from './numbers'
import { Decimal } from 'decimal.js';

const SCALE = parseUnits('1');
const ONE = new Decimal('1');

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
    desiredSpotPrice.div(spotPrice).pow(exponent).sub(ONE)
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
  const swapFeeComplement = ONE.sub(p.swapFee)
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
        .add(
          swapFeeComplement
          .mul(p.weightIn.div(p.weightOut).add(ONE))
        )
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

  // First determine if we should be trading first token for second,
  // or second token for first
  let assetInIndex = 0
  let assetOutIndex = 1

  const poolTokenIn = poolTokens[assetInIndex];
  const poolTokenOut = poolTokens[assetOutIndex];

  let pairData = poolPairData(poolState, assetInIndex, assetOutIndex);
  let spotPrice: Decimal = getSpotPrice(pairData);

  let desiredSpotPrice = new Decimal(
      (marketPrices[pairData.tokenIn] / marketPrices[pairData.tokenOut]).toString()
  );

  // If we need to trade asset 2 for asset 1 we have to switch directions
  if (desiredSpotPrice > spotPrice) {
    assetInIndex = 1
    assetOutIndex = 0

    pairData = poolPairData(poolState, assetInIndex, assetOutIndex);

    desiredSpotPrice = new Decimal(
      (marketPrices[pairData.tokenIn] / marketPrices[pairData.tokenOut]).toString()
    );
  }

  const NUM_ITERATIONS = 10;
 
  const amountDecimal = getAmountInForSpotPrice(pairData, desiredSpotPrice, NUM_ITERATIONS);
  const amount = fp(amountDecimal);

  console.log("Trading ", amountDecimal, ' ', pairData.tokenIn, ' for ', pairData.tokenOut);

  // determine how much
  const arb: BatchSwapStep = {
    poolId: poolState.id,
    assetInIndex,
    assetOutIndex,
    amount,
    userData: '0x',
  };
  return [arb];
}
