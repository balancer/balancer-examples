import { formatFixed } from '@ethersproject/bignumber';
import { WeightedPoolPairData } from './weightedPool';
import { BigNumber } from '@ethersproject/bignumber';
import { Decimal } from 'decimal.js';

const ONE = new Decimal('1')
const NEGATIVE_ONE = new Decimal('-1')

// All functions came from https://www.wolframcloud.com/obj/fernando.martinel/Published/SOR_equations_published.nb

/////////
/// Swap functions
/////////

// PairType = 'token->token'
// SwapType = 'swapExactIn'
export function _exactTokenInForTokenOut(amount: Decimal, poolPairData: WeightedPoolPairData): Decimal {
  const Bi = poolPairData.balanceIn;
  const Bo = poolPairData.balanceOut;
  const wi = poolPairData.weightIn;
  const wo = poolPairData.weightOut;
  const Ai = amount;
  const f = poolPairData.swapFee;
  return Bo.mul(
    ONE.minus(
      (Bi.div(
        Bi.plus(Ai.mul(ONE.sub(f))))
      ).pow(wi.div(wo))
    )
  );
  // return Bo.times(
  //     bnum(1).minus(
  //         bnum(
  //             Bi.div(
  //                 Bi.plus(Ai.times(bnum(1).minus(f)))
  //             ).toNumber() ** wi.div(wo).toNumber()
  //         )
  //     )
  // )
}

// PairType = 'token->token'
// SwapType = 'swapExactOut'
export function _tokenInForExactTokenOut(amount: Decimal, poolPairData: WeightedPoolPairData): Decimal {
  const Bi = poolPairData.balanceIn;
  const Bo = poolPairData.balanceOut;
  const wi = poolPairData.weightIn;
  const wo = poolPairData.weightOut;
  const Ao = amount;
  const f = poolPairData.swapFee;
  return Bi.mul(
    (((NEGATIVE_ONE).plus(
      (Bo.div(Bo.sub(Ao))).pow(wo.div(wi)))).div((NEGATIVE_ONE).sub(f))
    )
  );
  // return Bi.times(
  //     bnum(-1).plus(
  //         Bo.div(Bo.minus(Ao)).toNumber() **
  //             wo.div(wi).toNumber()
  //     )
  // ).div(bnum(1).minus(f));
}

// PairType = 'token->BPT'
// SwapType = 'swapExactOut'
export function _spotPriceAfterSwapTokenInForExactBPTOut(
  amount: Decimal,
  poolPairData: WeightedPoolPairData
): Decimal {
  const Bi = poolPairData.balanceIn;
  const Bbpt = poolPairData.balanceOut;
  const wi = poolPairData.weightIn;
  const Aobpt = amount;
  const f = poolPairData.swapFee;
  return (
    ((Aobpt.plus(Bbpt)).div(Bbpt)).pow(ONE.div(wi)).mul(Bi)
  ).div(
    (Aobpt.plus(Bbpt)).mul(ONE.plus(f.mul(wi.sub(ONE)))).mul(wi)
  );
}

/////////
/// SpotPriceAfterSwap
/////////

// PairType = 'token->token'
// SwapType = 'swapExactIn'
export function _spotPriceAfterSwapExactTokenInForTokenOut(
  amount: Decimal,
  poolPairData: WeightedPoolPairData
): Decimal {
  const Bi = poolPairData.balanceIn;
  const Bo = poolPairData.balanceOut;
  const wi = poolPairData.weightIn;
  const wo = poolPairData.weightOut;
  const Ai = amount;
  const f = poolPairData.swapFee;
  return NEGATIVE_ONE.mul(
    (Bi.mul(wo)).div(
      Bo.mul(
        f.sub(ONE)
      ).mul(
        Bi.div(Ai.plus(Bi).sub(Ai.mul(f)))
      ).pow((wi.plus(wo)).div(wo)).mul(wi)
    ));
}

// PairType = 'token->token'
// SwapType = 'swapExactOut'
export function _spotPriceAfterSwapTokenInForExactTokenOut(
  amount: Decimal,
  poolPairData: WeightedPoolPairData
): Decimal {
  const Bi = poolPairData.balanceIn;
  const Bo = poolPairData.balanceOut;
  const wi = poolPairData.weightIn;
  const wo = poolPairData.weightOut;
  const Ao = amount;
  const f = poolPairData.swapFee;
  return NEGATIVE_ONE.mul(
    (
      Bi.mul(Bo.div(Bo.sub(Ao))).pow((wi.plus(wo)).div(wi)).mul(wo)
    ).div(
      Bo.mul(f.sub(ONE)).mul(wi)
    )
  );
}

/////////
///  Derivatives of spotPriceAfterSwap
/////////

// PairType = 'token->token'
// SwapType = 'swapExactIn'
export function _derivativeSpotPriceAfterSwapExactTokenInForTokenOut(
  amount: Decimal,
  poolPairData: WeightedPoolPairData
): Decimal {
  const Bi = poolPairData.balanceIn;
  const Bo = poolPairData.balanceOut;
  const wi = poolPairData.weightIn;
  const wo = poolPairData.weightOut;
  const Ai = amount;
  const f = poolPairData.swapFee;
  return (
    wi.plus(wo)
  ).div(
    Bo.mul(Bi.div(Ai.plus(Bi).sub(Ai.mul(f))).pow(wi.div(wo)).mul(wi))
  );
}

// PairType = 'token->token'
// SwapType = 'swapExactOut'
export function _derivativeSpotPriceAfterSwapTokenInForExactTokenOut(
  amount: Decimal,
  poolPairData: WeightedPoolPairData
): Decimal {
  const Bi = poolPairData.balanceIn;
  const Bo = poolPairData.balanceOut;
  const wi = poolPairData.weightIn;
  const wo = poolPairData.weightOut;
  const Ao = amount;
  const f = poolPairData.swapFee;
  return NEGATIVE_ONE.mul(
    (Bi.mul(
      (Bo.div(Bo.sub(Ao))).pow(wo.div(wi))
    ).mul(
      wo.mul(wi.plus(wo))
    ).div(
      (Ao.sub(Bo)).pow(new Decimal(2)).mul(f.sub(ONE)).mul(wi.pow(new Decimal(2)))
    )
  ));
}
