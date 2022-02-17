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
import { Decimal } from 'decimal.js';
import { fromFp, fp } from '../../numbers'

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
  weightIn: Decimal;
  weightOut: Decimal;
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
  MAX_IN_RATIO = new Decimal('0.3');
  MAX_OUT_RATIO = new Decimal('0.3');

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

  getLimitAmountSwap(poolPairData: PoolPairBase, swapType: SwapTypes): Decimal {
    if (swapType === SwapTypes.SwapExactIn) {
      return poolPairData.balanceIn.mul(this.MAX_IN_RATIO);
    } else {
      return poolPairData.balanceOut.mul(this.MAX_OUT_RATIO);
    }
  }

  _spotPriceAfterSwapExactTokenInForTokenOut(poolPairData: WeightedPoolPairData, amount: Decimal): Decimal {
    return _spotPriceAfterSwapExactTokenInForTokenOut(amount, poolPairData);
  }

  _spotPriceAfterSwapTokenInForExactTokenOut(poolPairData: WeightedPoolPairData, amount: Decimal): Decimal{
    return _spotPriceAfterSwapTokenInForExactTokenOut(amount, poolPairData);
  }

  _derivativeSpotPriceAfterSwapExactTokenInForTokenOut(
    poolPairData: WeightedPoolPairData,
    amount: Decimal 
  ): Decimal {
    return _derivativeSpotPriceAfterSwapExactTokenInForTokenOut(amount, poolPairData);
  }

  _derivativeSpotPriceAfterSwapTokenInForExactTokenOut(
    poolPairData: WeightedPoolPairData,
    amount: Decimal 
  ): Decimal {
    return _derivativeSpotPriceAfterSwapTokenInForExactTokenOut(amount, poolPairData);
  }
}
