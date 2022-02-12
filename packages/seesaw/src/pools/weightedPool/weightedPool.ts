import { getAddress } from '@ethersproject/address';
import { isSameAddress } from '../../utils';
import {
  PoolBase,
  PoolTypes,
  SwapPairType,
  PoolPairBase,
  SwapTypes,
  SubgraphPoolBase,
  SubgraphToken,
  NoNullableField,
} from '../../types';
import {
  _exactTokenInForTokenOut,
  _tokenInForExactTokenOut,
  _spotPriceAfterSwapExactTokenInForTokenOut,
  _spotPriceAfterSwapTokenInForExactTokenOut,
  _derivativeSpotPriceAfterSwapExactTokenInForTokenOut,
  _derivativeSpotPriceAfterSwapTokenInForExactTokenOut,
} from './weightedMath';
import { BigNumber, formatFixed, parseFixed } from '@ethersproject/bignumber';
import { WeiPerEther as ONE } from '@ethersproject/constants';

function bnum(val: string | number | BigNumber): BigNumber {
  return BigNumber.from(val.toString());
}

export function scale(input: BigNumber, decimalPlaces: number): BigNumber {
  const scalePow = BigNumber.from(decimalPlaces.toString());
  const scaleMul = BigNumber.from(10).pow(scalePow);
  return input.mul(scaleMul);
}

const ZERO = BigNumber.from(0);

export type WeightedPoolToken = Pick<NoNullableField<SubgraphToken>, 'address' | 'balance' | 'decimals' | 'weight'>;

export type WeightedPoolPairData = PoolPairBase & {
  weightIn: BigNumber;
  weightOut: BigNumber;
};

export class WeightedPool implements PoolBase {
  poolType: PoolTypes = PoolTypes.Weighted;
  swapPairType: SwapPairType;
  id: string;
  address: string;
  swapFee: BigNumber;
  totalShares: BigNumber;
  tokens: WeightedPoolToken[];
  totalWeight: BigNumber;
  tokensList: string[];
  MAX_IN_RATIO = parseFixed('0.3', 18);
  MAX_OUT_RATIO = parseFixed('0.3', 18);

  static fromPool(pool: SubgraphPoolBase): WeightedPool {
    if (!pool.totalWeight) throw new Error('WeightedPool missing totalWeight');
    return new WeightedPool(
      pool.id,
      pool.address,
      pool.swapFee,
      pool.totalWeight,
      pool.totalShares,
      pool.tokens as WeightedPoolToken[],
      pool.tokensList
    );
  }

  constructor(
    id: string,
    address: string,
    swapFee: string,
    totalWeight: string,
    totalShares: string,
    tokens: WeightedPoolToken[],
    tokensList: string[]
  ) {
    this.id = id;
    this.address = address;
    this.swapFee = parseFixed(swapFee, 18);
    this.totalShares = parseFixed(totalShares, 18);
    this.tokens = tokens;
    this.tokensList = tokensList;
    this.totalWeight = parseFixed(totalWeight, 18);
  }

  setTypeForSwap(type: SwapPairType): void {
    this.swapPairType = type;
  }

  parsePoolPairData(tokenIn: string, tokenOut: string): WeightedPoolPairData {
    const tokenIndexIn = this.tokens.findIndex((t) => getAddress(t.address) === getAddress(tokenIn));
    if (tokenIndexIn < 0) throw 'Pool does not contain tokenIn';
    const tI = this.tokens[tokenIndexIn];
    const balanceIn = tI.balance;
    const decimalsIn = tI.decimals;
    const weightIn = parseFixed(tI.weight, 18).mul(ONE).div(this.totalWeight);

    const tokenIndexOut = this.tokens.findIndex((t) => getAddress(t.address) === getAddress(tokenOut));
    if (tokenIndexOut < 0) throw 'Pool does not contain tokenOut';
    const tO = this.tokens[tokenIndexOut];
    const balanceOut = tO.balance;
    const decimalsOut = tO.decimals;
    const weightOut = parseFixed(tO.weight, 18).mul(ONE).div(this.totalWeight);

    const poolPairData: WeightedPoolPairData = {
      id: this.id,
      address: this.address,
      poolType: this.poolType,
      tokenIn: tokenIn,
      tokenOut: tokenOut,
      decimalsIn: Number(decimalsIn),
      decimalsOut: Number(decimalsOut),
      balanceIn: parseFixed(balanceIn, decimalsIn),
      balanceOut: parseFixed(balanceOut, decimalsOut),
      weightIn: weightIn,
      weightOut: weightOut,
      swapFee: this.swapFee,
    };

    return poolPairData;
  }

  // Normalized liquidity is an abstract term that can be thought of the
  // inverse of the slippage. It is proportional to the token balances in the
  // pool but also depends on the shape of the invariant curve.
  // As a standard, we define normalized liquidity in tokenOut
  getNormalizedLiquidity(poolPairData: WeightedPoolPairData): BigNumber {
    return bnum(
      formatFixed(
        poolPairData.balanceOut.mul(poolPairData.weightIn).div(poolPairData.weightIn.add(poolPairData.weightOut)),
        poolPairData.decimalsOut
      )
    );
  }

  getLimitAmountSwap(poolPairData: PoolPairBase, swapType: SwapTypes): BigNumber {
    if (swapType === SwapTypes.SwapExactIn) {
      return bnum(formatFixed(poolPairData.balanceIn.mul(this.MAX_IN_RATIO).div(ONE), poolPairData.decimalsIn));
    } else {
      return bnum(formatFixed(poolPairData.balanceOut.mul(this.MAX_OUT_RATIO).div(ONE), poolPairData.decimalsOut));
    }
  }

  // Updates the balance of a given token for the pool
  updateTokenBalanceForPool(token: string, newBalance: BigNumber): void {
    // token is BPT
    if (this.address == token) {
      this.totalShares = newBalance;
    } else {
      // token is underlying in the pool
      const T = this.tokens.find((t) => isSameAddress(t.address, token));
      if (!T) throw Error('Pool does not contain this token');
      T.balance = formatFixed(newBalance, T.decimals);
    }
  }

  _spotPriceAfterSwapExactTokenInForTokenOut(poolPairData: WeightedPoolPairData, amount: BigNumber): BigNumber {
    return _spotPriceAfterSwapExactTokenInForTokenOut(amount, poolPairData);
  }

  _spotPriceAfterSwapTokenInForExactTokenOut(poolPairData: WeightedPoolPairData, amount: BigNumber): BigNumber {
    return _spotPriceAfterSwapTokenInForExactTokenOut(amount, poolPairData);
  }

  _derivativeSpotPriceAfterSwapExactTokenInForTokenOut(
    poolPairData: WeightedPoolPairData,
    amount: BigNumber
  ): BigNumber {
    return _derivativeSpotPriceAfterSwapExactTokenInForTokenOut(amount, poolPairData);
  }

  _derivativeSpotPriceAfterSwapTokenInForExactTokenOut(
    poolPairData: WeightedPoolPairData,
    amount: BigNumber
  ): BigNumber {
    return _derivativeSpotPriceAfterSwapTokenInForExactTokenOut(amount, poolPairData);
  }
}
