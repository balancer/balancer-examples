import { WeightedPoolPairData } from './pools/weightedPool/weightedPool';
import { _spotPriceAfterSwapTokenInForExactTokenOut } from './pools/weightedPool/weightedMath';
import { PoolState, PoolTypes } from './types';
import {
  BatchSwapStep,
} from '@balancer-labs/balancer-js';
import { BigNumber, formatFixed, FixedNumber } from '@ethersproject/bignumber';
import { parseUnits } from '@ethersproject/units';

const SCALE = parseUnits('1')

function multiplyFP(a: BigNumber, b: BigNumber): BigNumber {
  return a.mul(b).div(SCALE)
}

function divideFP(a: BigNumber, b: BigNumber): BigNumber {
  return a.mul(SCALE).div(b)
}



export function getSpotPrice(pairData: WeightedPoolPairData): BigNumber{
  const swapFeeComplement = SCALE.sub(pairData.swapFee)
  const balanceOverWeightIn = divideFP(
    pairData.balanceIn,
    pairData.weightIn
  )

  const balanceOverWeightOut = divideFP(pairData.balanceOut, pairData.weightOut)

  console.log(swapFeeComplement, balanceOverWeightIn, balanceOverWeightOut)

  return divideFP(
    divideFP(
      balanceOverWeightOut,
      balanceOverWeightIn
    ),
    swapFeeComplement
  )

  //return balanceOverWeightIn 
    //.mul(SCALE)
    //.div(balanceOverWeightOut)
    //.mul(SCALE)
    //.div(swapFeeComplement);
}

export function getAmountInForSpotPriceAfterSwapNoFees(pairData: WeightedPoolPairData, desiredSpotPrice: BigNumber) {
  let spotPrice = getSpotPrice(pairData);
  console.log("Spot price, desired spot price", spotPrice, desiredSpotPrice)
  const exponent = divideFP(pairData.weightOut, pairData.weightIn.add(pairData.weightOut)).sub(SCALE)
  return multiplyFP(
    pairData.balanceIn,
    divideFP(desiredSpotPrice, spotPrice).pow(exponent)
  )

  return pairData.balanceIn.mul(
    desiredSpotPrice.div(spotPrice).pow(pairData.weightOut.div(pairData.weightIn.add(pairData.weightOut)).sub(SCALE))
  );
}

function poolPairData(pool: PoolState, inputTokenIndex, outputTokenIndex): WeightedPoolPairData {
  const poolType = PoolTypes.Weighted;
  return {
    id: pool.id,
    address: pool.address,
    swapFee: pool.swapFee,
    poolType,
    tokenIn: pool.tokens[inputTokenIndex],
    decimalsIn: 18, // TODO
    balanceIn: pool.balances[inputTokenIndex],
    weightIn: pool.weights[inputTokenIndex],
    tokenOut: pool.tokens[outputTokenIndex],
    balanceOut: pool.balances[outputTokenIndex],
    decimalsOut: 18, // TODO
    weightOut: pool.weights[outputTokenIndex],
  };
}

function getExtraAmountIn(
  p: WeightedPoolPairData,
  currentSpotPrice: BigNumber,
  amountIn: BigNumber,
  desiredSpotPrice: BigNumber
): BigNumber {
  return BigNumber.from(
    BigNumber.from(1)
      .sub(p.swapFee)
      .mul(amountIn)
      .add(p.balanceIn)
      .mul(desiredSpotPrice.sub(currentSpotPrice))
      .div(
        currentSpotPrice.mul(
          p.swapFee
            .mul(p.balanceIn)
            .div(amountIn.add(p.balanceIn))
            .add(BigNumber.from(1).sub(p.swapFee))
            .mul(p.weightIn.div(p.weightOut).add(1))
        )
      )
  );
}

export function getAmountInForSpotPrice(pair: WeightedPoolPairData, desiredSpotPrice: BigNumber, numIterations: number) {
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

export function identifyArbitrageOpp(marketPrices: { [key: string]: number }, poolState: PoolState): BatchSwapStep[] {
  const assetInIndex = 0; // TODO
  const assetOutIndex = 1; // TODO

  const weightedPoolPairData = poolPairData(poolState, assetInIndex, assetOutIndex);
  const NUM_ITERATIONS = 10;
  console.log(marketPrices);
  const desiredSpotPrice = parseUnits(
    (marketPrices[weightedPoolPairData.tokenIn]/(marketPrices[weightedPoolPairData.tokenOut])).toString()
  );
  console.log(desiredSpotPrice, formatFixed(desiredSpotPrice));
  const amount = getAmountInForSpotPrice(weightedPoolPairData, desiredSpotPrice, NUM_ITERATIONS);

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
