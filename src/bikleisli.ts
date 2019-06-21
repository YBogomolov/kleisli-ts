/*
 *  Copyright 2019 Yuriy Bogomolov
 *
 *  Licensed under the Apache LicensVersion 2.0 (the "License");
 *  you may not use this file except in compliance with the License.
 *  You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 */

import { Comonad1 } from 'fp-ts/lib/Comonad';
import { Either, fold, left as eitherLeft, right as eitherRight } from 'fp-ts/lib/Either';
import { flow } from 'fp-ts/lib/function';
import { Kind, URIS } from 'fp-ts/lib/HKT';
import { Monad1 } from 'fp-ts/lib/Monad';
import { pipe } from 'fp-ts/lib/pipeable';

/**
 * Kleisli – an effectful function from `A` to `Kind<F, B>`.
 * For more intuition about Kleisli arrows please @see http://www.cse.chalmers.se/~rjmh/Papers/arrows.pdf
 *
 * @template A domain type
 * @template B codomain type
 */
export abstract class BiKleisli<F extends URIS, G extends URIS, A, B> {
  abstract tag: 'Pure' | 'Impure' | 'Compose';

  /**
   * Executes current `Kleisli`, yielding IO of either ann error of type `E` or value of type `B`.
   * @param a Value of type `A`
   */
  abstract run(a: A): Kind<F, B>;

  abstract M: Monad1<F>;
  abstract W: Comonad1<G>;

  /**
   * Applicative `ap` function.
   * Apply a lifted in `Kleisli` context function to current value of `Kleisli`.
   * @param fbc Function from `B` to `C`, lifted in the context of `Kleisli`
   */
  ap<C>(fbc: BiKleisli<F, G, A, (b: B) => C>): BiKleisli<F, G, A, C> {
    return pure(this.M, this.W)((a) => this.M.ap(fbc.run(a), this.run(a)));
  }

  /**
   * Functorial `map` function.
   * Lift the passed function `f` into a context of `Kleisli`.
   * @param f Function from `B` to `C` to transform the encapsulated value
   */
  map<C>(f: (b: B) => C): BiKleisli<F, G, A, C> {
    return this.andThen(liftK(this.M, this.W)(f));
  }

  /**
   * Monadic `chain` function.
   * Apply function `f` to the result of current `Kleisli<F, A, B>`, determining the next flow of computations.
   * @param f Function from `B` to `Kleisli<F, A, C>`, which represents next sequential computation.
   */
  chain<C>(f: (b: B) => BiKleisli<F, G, A, C>) {
    return pure(this.M, this.W)<A, C>((a) => this.M.chain(this.run(a), (b) => f(b).run(a)));
  }

  /**
   * Compose current `Kleisli` with the next one.
   * @param that Sequential `Kleisli` computation
   */
  andThen<C>(that: BiKleisli<F, G, B, C>): BiKleisli<F, G, A, C> {
    return composeK(this.M, this.W)(that, this);
  }

  /**
   * Execute `this` and `that` computations and if both succeed, process the results with `f`.
   * @see both
   * @param that Second `Kleisli` computation to run alongside with current
   * @param f Function to process the results of both computations
   */
  zipWith<C, D>(that: BiKleisli<F, G, A, C>): (f: (t: [B, C]) => D) => BiKleisli<F, G, A, D> {
    return (f) => zipWith(this.M, this.W)<A, B, C, D>(this, that)(f);
  }

  /**
   * Execute `this` and `that` computations and return a tuple of results.
   * @see zipWith
   * @param that Second `Kleisli` computation to run alongside with current
   */
  both<C>(that: BiKleisli<F, G, A, C>): BiKleisli<F, G, A, [B, C]> {
    return zipWith(this.M, this.W)<A, B, C, [B, C]>(this, that)((x) => x);
  }

  /**
   * Depending on an input, run ether `this` or `that` computation.
   * @param that Alternative computation
   */
  join<C>(that: BiKleisli<F, G, C, B>): BiKleisli<F, G, Either<A, C>, B> {
    return switchK(this.M, this.W)(this, that);
  }

  /**
   * Pass the original imput of type `A` alongside with the result of computation of type `B`, which comes *first*.
   */
  first(): BiKleisli<F, G, A, [B, A]> {
    return this.both(identity(this.M, this.W)<A>());
  }

  /**
   * Pass the original imput of type `A` alongside with the result of computation of type `B`, which comes *second*.
   */
  second(): BiKleisli<F, G, A, [A, B]> {
    return identity(this.M, this.W)<A>().both(this);
  }

  /**
   * Discard the results of `this` computation and return `c`.
   * @param c Value of type `C` to return
   */
  constant<C>(c: C): BiKleisli<F, G, A, C> {
    return this.andThen(liftK(this.M, this.W)(() => c));
  }

  /**
   * Discard the results of `this` computation.
   */
  toVoid(): BiKleisli<F, G, A, void> {
    return this.constant(void 0);
  }

  /**
   * Discard the results of `this` computation and propagate the original input.
   * Effectively just keep the effect of `this` computation.
   */
  asEffect(): BiKleisli<F, G, A, A> {
    return this.first().andThen(snd(this.M, this.W)());
  }
}

/**
 * Specialized error type for Kleisli
 */
class KleisliError<E> extends Error {
  constructor(readonly error: E) { super(String(error)); }
}

/**
 * A pure functional computation from `A` to `Kind<F, B>`, which **never** throws in runtime.
 *
 * @see Kleisli
 *
 * @template A domain type
 * @template B codomain type
 */
class Pure<F extends URIS, G extends URIS, A, B> extends BiKleisli<F, G, A, B> {
  readonly tag = 'Pure';
  constructor(readonly M: Monad1<F>, readonly W: Comonad1<G>, readonly _run: (a: A) => Kind<F, B>) { super(); }

  run = (a: A): Kind<F, B> => this._run(a);
}

/**
 * An impure effectful computation from `A` to `B`, which may throw an exception of type `E`
 *
 * @see Kleisli
 *
 * @template A domain type
 * @template B codomain type
 */
class Impure<F extends URIS, G extends URIS, A, B> extends BiKleisli<F, G, A, B> {
  readonly tag = 'Impure';
  constructor(readonly M: Monad1<F>, readonly W: Comonad1<G>, readonly _run: (a: A) => B) { super(); }

  run = (a: A): Kind<F, B> => {
    const b = this._run(a);
    return this.M.of(b);
  }
}

/**
 * A right-to-left composition of two Kleisli functions.
 *
 * @see Kleisli
 *
 * @template A domain type
 * @template B codomain type
 */
class Compose<F extends URIS, G extends URIS, A, B, C> extends BiKleisli<F, G, A, C> {
  readonly tag = 'Compose';
  constructor(
    readonly M: Monad1<F>,
    readonly W: Comonad1<G>,
    readonly g: BiKleisli<F, G, B, C>,
    readonly f: BiKleisli<F, G, A, B>,
  ) { super(); }

  run = (a: A): Kind<F, C> => this.M.chain(this.f.run(a), this.g.run);
}

const isImpure = <F extends URIS, G extends URIS, A, B>(a: BiKleisli<F, G, A, B>): a is Impure<F, G, A, B> =>
  a.tag === 'Impure';

/**
 * Create a new instance of `Pure` computation.
 * @param f Function to run
 */
export const pure = <F extends URIS, G extends URIS>(M: Monad1<F>, W: Comonad1<G>) =>
  <A, B>(f: (a: A) => Kind<F, B>): BiKleisli<F, G, A, B> => new Pure<F, G, A, B>(M, W, f);

/**
 * Create a new instance of `Impure` computation.
 * @param catcher Function to transform the error from `Error` into `E`
 * @param f Impure computation from `A` to `B` which may throw
 */
export const impure = <F extends URIS, G extends URIS>(M: Monad1<F>, W: Comonad1<G>) =>
  <E>(catcher: (e: Error) => E) => <A, B>(f: (a: A) => B): BiKleisli<F, G, A, B> => new Impure(
    M,
    W,
    (a: A) => {
      try {
        return f(a);
      } catch (error) {
        if (catcher(error) !== undefined) {
          throw new KleisliError<E>(catcher(error));
        }
        throw error;
      }
    },
  );

const voidCatcher = (e: Error): never => { throw e; };

/**
 * Create a new `Kleisli` computation from impure function which *you know* to never throw exceptions,
 * or throw exceptions which should lead to termination fo the program.
 * @param f Impure computation from `A` to `B`
 */
export const impureVoid = <F extends URIS, G extends URIS>(M: Monad1<F>, W: Comonad1<G>) =>
  <A, B>(f: (a: A) => B): BiKleisli<F, G, A, B> => impure(M, W)(voidCatcher)(f);

/**
 * Lift the impure computation into `Kleisli` context.
 * @param f Impure function from `A` to `B`
 */
export const liftK = <F extends URIS, G extends URIS>(M: Monad1<F>, W: Comonad1<G>) =>
  <A, B>(f: (a: A) => B): BiKleisli<F, G, A, B> => new Impure(M, W, f);

/**
 * Monadic `chain` function.
 * Apply function `f` to the result of current `Kleisli<F, A, B>`, determining the next flow of computations.
 * @param fa Basic Kleisli computation
 * @param f Function from `B` to `Kleisli<F, A, C>`, which represents next sequential computation
 */
export const chain = <F extends URIS, G extends URIS>(M: Monad1<F>, W: Comonad1<G>) =>
  <A, B, C>(fa: BiKleisli<F, G, A, B>, f: (b: B) => BiKleisli<F, G, A, C>): BiKleisli<F, G, A, C> =>
    pure(M, W)<A, C>((a) => M.chain(fa.run(a), (b) => f(b).run(a)));

/**
 * Create a new `Kleisli` computation which result in `b`.
 * @param b Lazy value of type `B`
 */
export const point = <F extends URIS, G extends URIS>(M: Monad1<F>, W: Comonad1<G>) =>
  <A, B>(b: () => B): BiKleisli<F, G, A, B> => liftK(M, W)(b);

/**
 * Applicative `of` function.
 * Lift a value of type `B` into a context of `Kleisli`.
 * @param b Value of type `B`
 */
export const of = <F extends URIS, G extends URIS>(M: Monad1<F>, W: Comonad1<G>) =>
  <A, B>(b: B): BiKleisli<F, G, A, B> => liftK(M, W)(() => b);

/**
 * Tuple swap, lifted in `Kleisli` context.
 */
export const swap = <F extends URIS, G extends URIS>(M: Monad1<F>, W: Comonad1<G>) =>
  <A, B>(): BiKleisli<F, G, [A, B], [B, A]> => liftK(M, W)(([a, b]) => [b, a]);

/**
 * Perform right-to-left Kleisli arrows compotions.
 * @param second Second computation to apply
 * @param first First computation to apply
 */
export const composeK = <F extends URIS, G extends URIS>(M: Monad1<F>, W: Comonad1<G>) =>
  <A, B, C>(second: BiKleisli<F, G, B, C>, first: BiKleisli<F, G, A, B>): BiKleisli<F, G, A, C> =>
    isImpure(second) && isImpure(first) ?
      new Impure(M, W, flow(first._run, second._run)) :
      new Compose(M, W, second, first);

/**
 * Perform left-to-right Kleisli arrows compotions.
 * @param first First computation to apply
 * @param second Second computation to apply
 */
export const pipeK = <F extends URIS, G extends URIS>(M: Monad1<F>, W: Comonad1<G>) =>
  <A, B, C>(first: BiKleisli<F, G, A, B>, second: BiKleisli<F, G, B, C>): BiKleisli<F, G, A, C> =>
    composeK(M, W)(second, first);

/**
 * Depending on the input of type `Either<A, C>`, execute either `l` or `r` branches.
 * @param l Left branch of computation
 * @param r Right branch of computation
 */
export const switchK = <F extends URIS, G extends URIS>(M: Monad1<F>, W: Comonad1<G>) =>
  <A, B, C>(l: BiKleisli<F, G, A, B>, r: BiKleisli<F, G, C, B>): BiKleisli<F, G, Either<A, C>, B> =>
    isImpure(l) && isImpure(r) ?
      new Impure<F, G, Either<A, C>, B>(M, W, (a) => pipe(
        a,
        fold(
          (al) => l._run(al),
          (ar) => r._run(ar),
        )),
      ) :
      pure(M, W)((a) => pipe(
        a,
        fold(
          (al) => l.run(al),
          (ar) => r.run(ar),
        )),
      );

/**
 * Execute `l` and `r` computations and if both succeed, process the results with `f`.
 * @param l First `Kleisli` computation
 * @param r Second `Kleisli` computation
 * @param f Function to process the results of both computations
 */
export const zipWith = <F extends URIS, G extends URIS>(M: Monad1<F>, W: Comonad1<G>) =>
  <A, B, C, D>(l: BiKleisli<F, G, A, B>, r: BiKleisli<F, G, A, C>) =>
    (f: (t: [B, C]) => D): BiKleisli<F, G, A, D> =>
      isImpure(l) && isImpure(r) ?
        new Impure<F, G, A, D>(M, W, (a) => f([l._run(a), r._run(a)])) :
        pure(M, W)((a) => M.chain(l.run(a), (b) => M.map(r.run(a), (c) => f([b, c]))));

/**
 * Propagate the input unchanged.
 */
export const identity = <F extends URIS, G extends URIS>(M: Monad1<F>, W: Comonad1<G>) =>
  <A>(): BiKleisli<F, G, A, A> => liftK(M, W)((x) => x);

/**
 * Execute either the `k` computation or propagate the value of type `C` through, depending on an input.
 * A flipped version of @see right.
 * @param k Computation from `A` to `B`
 */
export const left = <F extends URIS, G extends URIS>(M: Monad1<F>, W: Comonad1<G>) =>
  <A, B, C>(k: BiKleisli<F, G, A, B>): BiKleisli<F, G, Either<A, C>, Either<B, C>> =>
    isImpure(k) ?
      new Impure(M, W, (a) => pipe(a, fold(
        (l) => eitherLeft(k._run(l)),
        (r) => eitherRight(r),
      ))) :
      pure(M, W)((a) => pipe(a, fold(
        (l) => M.map(k.run(l), (x) => eitherLeft(x)),
        (r) => M.of(eitherRight(r)),
      )));

/**
 * Execute either the `k` computation or propagate the value of type `C` through, depending on an input.
 * A flipped version of @see left.
 * @param k Computation from `A` to `B`
 */
export const right = <F extends URIS, G extends URIS>(M: Monad1<F>, W: Comonad1<G>) =>
  <A, B, C>(k: BiKleisli<F, G, A, B>): BiKleisli<F, G, Either<C, A>, Either<C, B>> =>
    isImpure(k) ?
      new Impure(M, W, (a) => pipe(a, fold(
        (l) => eitherLeft(l),
        (r) => eitherRight(k._run(r)),
      ))) :
      pure(M, W)((a) => pipe(a, fold(
        (l) => M.of(eitherLeft(l)),
        (r) => M.map(k.run(r), (x) => eitherRight(x)),
      )));

/**
 * Depending on the condition, propagate the original input through the left or right part of `Either`.
 * @param cond Predicate for `A`
 */
export const test = <F extends URIS, G extends URIS>(M: Monad1<F>, W: Comonad1<G>) =>
  <A>(cond: BiKleisli<F, G, A, boolean>): BiKleisli<F, G, A, Either<A, A>> =>
    cond.both(identity(M, W)()).andThen(liftK(M, W)(([c, a]) => c ? eitherLeft(a) : eitherRight(a)));

/**
 * Depending on the condition, execute either `then` or `else`.
 * @param cond Predicate for `A`
 * @param then Computation to run if `cond` is `true`
 * @param else_ Computation to run if `cond` is `false`
 */
export const ifThenElse = <F extends URIS, G extends URIS>(M: Monad1<F>, W: Comonad1<G>) =>
  <A, B>(cond: BiKleisli<F, G, A, boolean>) =>
    (then: BiKleisli<F, G, A, B>) => (else_: BiKleisli<F, G, A, B>): BiKleisli<F, G, A, B> =>
      isImpure(cond) && isImpure(then) && isImpure(else_) ?
        new Impure(M, W, (a) => cond._run(a) ? then._run(a) : else_._run(a)) :
        test(M, W)(cond).andThen(switchK(M, W)(then, else_));

/**
 * Simplified version of @see ifThenElse without the `else` part.
 * @param cond Predicate for `A`
 * @param then Computation to run if `cond` is `true`
 */
export const ifThen = <F extends URIS, G extends URIS>(M: Monad1<F>, W: Comonad1<G>) =>
  <A>(cond: BiKleisli<F, G, A, boolean>) =>
    (then: BiKleisli<F, G, A, A>): BiKleisli<F, G, A, A> => ifThenElse(M, W)<A, A>(cond)(then)(identity(M, W)());

/**
 * While-loop: run `body` until `cond` is `true`.
 * @param cond Predicate for `A`
 * @param body Computation to run continuously until `cond` is `false`
 */
export const whileDo = <F extends URIS, G extends URIS>(M: Monad1<F>, W: Comonad1<G>) =>
  <A>(cond: BiKleisli<F, G, A, boolean>) => (body: BiKleisli<F, G, A, A>): BiKleisli<F, G, A, A> => {
    if (isImpure(cond) && isImpure(body)) {
      return new Impure<F, G, A, A>(
        M,
        W,
        (a0) => {
          let a = a0;

          while (cond._run(a)) {
            a = body._run(a);
          }

          return a;
        },
      );
    } else {
      const loop = (): BiKleisli<F, G, A, A> =>
        pure(M, W)<A, A>((a) => M.chain(cond.run(a), (b) => b ? M.chain(body.run(a), loop().run) : M.of(a)));

      return loop();
    }
  };

/**
 * Lifted version of `fst` tuple function.
 */
export const fst = <F extends URIS, G extends URIS>(M: Monad1<F>, W: Comonad1<G>) =>
  <A, B>(): BiKleisli<F, G, [A, B], A> => liftK(M, W)(([a]) => a);

/**
 * Lifted version of `snd` tuple function.
 */
export const snd = <F extends URIS, G extends URIS>(M: Monad1<F>, W: Comonad1<G>) =>
  <A, B>(): BiKleisli<F, G, [A, B], B> => liftK(M, W)(([, b]) => b);

/**
 * Convenience method which retruns instances of Kleisli API for the given monad.
 * @param M Monad1 & Bifunctor instance
 */
export const getInstancesFor = <F extends URIS, G extends URIS>(M: Monad1<F>, W: Comonad1<G>) => ({
  /**
   * Applicative `of` function.
   * Lift a value of type `B` into a context of `Kleisli`.
   * @param b Value of type `B`
   */
  of: of(M, W),
  /**
   * Create a new instance of `Pure` computation.
   * @param f Function to run
   */
  pure: pure(M, W),
  /**
   * Create a new instance of `Impure` computation.
   * @param catcher Function to transform the error from `Error` into `E`
   * @param f Impure computation from `A` to `B` which may throw
   */
  impure: impure(M, W),
  /**
   * Create a new `Kleisli` computation from impure function which *you know* to never throw exceptions,
   * or throw exceptions which should lead to termination fo the program.
   * @param f Impure computation from `A` to `B`
   */
  impureVoid: impureVoid(M, W),
  /**
   * Lift the impure computation into `Kleisli` context.
   * @param f Impure function from `A` to `B`
   */
  liftK: liftK(M, W),
  /**
   * Monadic `chain` function.
   * Apply function `f` to the result of current `Kleisli<F, A, B>`, determining the next flow of computations.
   * @param fa Basic Kleisli computation
   * @param f Function from `B` to `Kleisli<F, A, C>`, which represents next sequential computation
   */
  chain: chain(M, W),
  /**
   * Create a new `Kleisli` computation which result in `b`.
   * @param b Lazy value of type `B`
   */
  point: point(M, W),
  /**
   * Tuple swap, lifted in `Kleisli` context.
   */
  swap: swap(M, W),
  /**
   * Perform right-to-left Kleisli arrows compotions.
   * @param second Second computation to apply
   * @param first First computation to apply
   */
  composeK: composeK(M, W),
  /**
   * Perform left-to-right Kleisli arrows compotions.
   * @param first First computation to apply
   * @param second Second computation to apply
   */
  pipeK: pipeK(M, W),
  /**
   * Depending on the input of type `Either<A, C>`, execute either `l` or `r` branches.
   * @param l Left branch of computation
   * @param r Right branch of computation
   */
  switchK: switchK(M, W),
  /**
   * Execute `l` and `r` computations and if both succeed, process the results with `f`.
   * @param l First `Kleisli` computation
   * @param r Second `Kleisli` computation
   * @param f Function to process the results of both computations
   */
  zipWith: zipWith(M, W),
  /**
   * Propagate the input unchanged.
   */
  identity: identity(M, W),
  /**
   * Execute either the `k` computation or propagate the value of type `C` through, depending on an input.
   * A flipped version of @see right.
   * @param k Computation from `A` to `B`
   */
  left: left(M, W),
  /**
   * Execute either the `k` computation or propagate the value of type `C` through, depending on an input.
   * A flipped version of @see left.
   * @param k Computation from `A` to `B`
   */
  right: right(M, W),
  /**
   * Depending on the condition, propagate the original input through the left or right part of `Either`.
   * @param cond Predicate for `A`
   */
  test: test(M, W),
  /**
   * Depending on the condition, execute either `then` or `else`.
   * @param cond Predicate for `A`
   * @param then Computation to run if `cond` is `true`
   * @param else_ Computation to run if `cond` is `false`
   */
  ifThenElse: ifThenElse(M, W),
  /**
   * Simplified version of @see ifThenElse without the `else` part.
   * @param cond Predicate for `A`
   * @param then Computation to run if `cond` is `true`
   */
  ifThen: ifThen(M, W),
  /**
   * While-loop: run `body` until `cond` is `true`.
   * @param cond Predicate for `A`
   * @param body Computation to run continuously until `cond` is `false`
   */
  whileDo: whileDo(M, W),
  /**
   * Lifted version of `fst` tuple function.
   */
  fst: fst(M, W),
  /**
   * Lifted version of `snd` tuple function.
   */
  snd: snd(M, W),
});

export default getInstancesFor;
