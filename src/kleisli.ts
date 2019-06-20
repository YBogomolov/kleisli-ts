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

import { Either, fold, left as eitherLeft, right as eitherRight } from 'fp-ts/lib/Either';
import { compose } from 'fp-ts/lib/function';
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
export abstract class Kleisli<F extends URIS, A, B> {
  abstract tag: 'Pure' | 'Impure' | 'Compose';

  /**
   * Executes current `Kleisli`, yielding IO of either ann error of type `E` or value of type `B`.
   * @param a Value of type `A`
   */
  abstract run(a: A): Kind<F, B>;

  abstract M: Monad1<F>;

  /**
   * Applicative `ap` function.
   * Apply a lifted in `Kleisli` context function to current value of `Kleisli`.
   * @param fbc Function from `B` to `C`, lifted in the context of `Kleisli`
   */
  ap<C>(fbc: Kleisli<F, A, (b: B) => C>): Kleisli<F, A, C> {
    return pure(this.M)((a) => this.M.ap(fbc.run(a), this.run(a)));
  }

  /**
   * Functorial `map` function.
   * Lift the passed function `f` into a context of `Kleisli`.
   * @param f Function from `B` to `C` to transform the encapsulated value
   */
  map<C>(f: (b: B) => C): Kleisli<F, A, C> {
    return this.andThen(liftK(this.M)(f));
  }

  /**
   * Monadic `chain` function.
   * Apply function `f` to the result of current `Kleisli<F, A, B>`, determining the next flow of computations.
   * @param f Function from `B` to `Kleisli<F, A, C>`, which represents next sequential computation.
   */
  chain<C>(f: (b: B) => Kleisli<F, A, C>) {
    return pure(this.M)<A, C>((a) => this.M.chain(this.run(a), (b) => f(b).run(a)));
  }

  /**
   * Compose current `Kleisli` with the next one.
   * @param that Sequential `Kleisli` computation
   */
  andThen<C>(that: Kleisli<F, B, C>): Kleisli<F, A, C> {
    return composeK(this.M)(that, this);
  }

  /**
   * Execute `this` and `that` computations and if both succeed, process the results with `f`.
   * @see both
   * @param that Second `Kleisli` computation to run alongside with current
   * @param f Function to process the results of both computations
   */
  zipWith<C, D>(that: Kleisli<F, A, C>): (f: (t: [B, C]) => D) => Kleisli<F, A, D> {
    return (f) => zipWith(this.M)<A, B, C, D>(this, that)(f);
  }

  /**
   * Execute `this` and `that` computations and return a tuple of results.
   * @see zipWith
   * @param that Second `Kleisli` computation to run alongside with current
   */
  both<C>(that: Kleisli<F, A, C>): Kleisli<F, A, [B, C]> {
    return zipWith(this.M)<A, B, C, [B, C]>(this, that)((x) => x);
  }

  /**
   * Depending on an input, run ether `this` or `that` computation.
   * @param that Alternative computation
   */
  join<C>(that: Kleisli<F, C, B>): Kleisli<F, Either<A, C>, B> {
    return switchK(this.M)(this, that);
  }

  /**
   * Pass the original imput of type `A` alongside with the result of computation of type `B`, which comes *first*.
   */
  first(): Kleisli<F, A, [B, A]> {
    return this.both(identity(this.M)<A>());
  }

  /**
   * Pass the original imput of type `A` alongside with the result of computation of type `B`, which comes *second*.
   */
  second(): Kleisli<F, A, [A, B]> {
    return identity(this.M)<A>().both(this);
  }

  /**
   * Discard the results of `this` computation and return `c`.
   * @param c Value of type `C` to return
   */
  constant<C>(c: C): Kleisli<F, A, C> {
    return this.andThen(liftK(this.M)(() => c));
  }

  /**
   * Discard the results of `this` computation.
   */
  toVoid(): Kleisli<F, A, void> {
    return this.constant(void 0);
  }

  /**
   * Discard the results of `this` computation and propagate the original input.
   * Effectively just keep the effect of `this` computation.
   */
  asEffect(): Kleisli<F, A, A> {
    return this.first().andThen(snd(this.M)());
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
class Pure<F extends URIS, A, B> extends Kleisli<F, A, B> {
  readonly tag = 'Pure';
  constructor(readonly M: Monad1<F>, readonly _run: (a: A) => Kind<F, B>) { super(); }

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
class Impure<F extends URIS, A, B> extends Kleisli<F, A, B> {
  readonly tag = 'Impure';
  constructor(readonly M: Monad1<F>, readonly _run: (a: A) => B) { super(); }

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
class Compose<F extends URIS, A, B, C> extends Kleisli<F, A, C> {
  readonly tag = 'Compose';
  constructor(
    readonly M: Monad1<F>,
    readonly g: Kleisli<F, B, C>,
    readonly f: Kleisli<F, A, B>,
  ) { super(); }

  run = (a: A): Kind<F, C> => this.M.chain(this.f.run(a), this.g.run);
}

const isImpure = <F extends URIS, A, B>(a: Kleisli<F, A, B>): a is Impure<F, A, B> => a.tag === 'Impure';

/**
 * Create a new instance of `Pure` computation.
 * @param f Function to run
 */
export const pure = <F extends URIS>(M: Monad1<F>) =>
  <A, B>(f: (a: A) => Kind<F, B>): Kleisli<F, A, B> => new Pure<F, A, B>(M, f);

/**
 * Create a new instance of `Impure` computation.
 * @param catcher Function to transform the error from `Error` into `E`
 * @param f Impure computation from `A` to `B` which may throw
 */
export const impure = <F extends URIS>(M: Monad1<F>) =>
  <E>(catcher: (e: Error) => E) => <A, B>(f: (a: A) => B): Kleisli<F, A, B> => new Impure(
    M,
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
export const impureVoid = <F extends URIS>(M: Monad1<F>) =>
  <A, B>(f: (a: A) => B): Kleisli<F, A, B> => impure(M)(voidCatcher)(f);

/**
 * Lift the impure computation into `Kleisli` context.
 * @param f Impure function from `A` to `B`
 */
export const liftK = <F extends URIS>(M: Monad1<F>) =>
  <A, B>(f: (a: A) => B): Kleisli<F, A, B> => new Impure(M, f);

/**
 * Monadic `chain` function.
 * Apply function `f` to the result of current `Kleisli<F, A, B>`, determining the next flow of computations.
 * @param fa Basic Kleisli computation
 * @param f Function from `B` to `Kleisli<F, A, C>`, which represents next sequential computation
 */
export const chain = <F extends URIS>(M: Monad1<F>) =>
  <A, B, C>(fa: Kleisli<F, A, B>, f: (b: B) => Kleisli<F, A, C>): Kleisli<F, A, C> =>
    pure(M)<A, C>((a) => M.chain(fa.run(a), (b) => f(b).run(a)));

/**
 * Create a new `Kleisli` computation which result in `b`.
 * @param b Lazy value of type `B`
 */
export const point = <F extends URIS>(M: Monad1<F>) =>
  <A, B>(b: () => B): Kleisli<F, A, B> => liftK(M)(b);

/**
 * Applicative `of` function.
 * Lift a value of type `B` into a context of `Kleisli`.
 * @param b Value of type `B`
 */
export const of = <F extends URIS>(M: Monad1<F>) =>
  <A, B>(b: B): Kleisli<F, A, B> => liftK(M)(() => b);

/**
 * Tuple swap, lifted in `Kleisli` context.
 */
export const swap = <F extends URIS>(M: Monad1<F>) =>
  <A, B>(): Kleisli<F, [A, B], [B, A]> => liftK(M)(([a, b]) => [b, a]);

/**
 * Perform right-to-left Kleisli arrows compotions.
 * @param second Second computation to apply
 * @param first First computation to apply
 */
export const composeK = <F extends URIS>(M: Monad1<F>) =>
  <A, B, C>(second: Kleisli<F, B, C>, first: Kleisli<F, A, B>): Kleisli<F, A, C> =>
    isImpure(second) && isImpure(first) ?
      new Impure(M, compose(second._run, first._run)) :
      new Compose(M, second, first);

/**
 * Perform left-to-right Kleisli arrows compotions.
 * @param first First computation to apply
 * @param second Second computation to apply
 */
export const pipeK = <F extends URIS>(M: Monad1<F>) =>
  <A, B, C>(first: Kleisli<F, A, B>, second: Kleisli<F, B, C>): Kleisli<F, A, C> =>
    composeK(M)(second, first);

/**
 * Depending on the input of type `Either<A, C>`, execute either `l` or `r` branches.
 * @param l Left branch of computation
 * @param r Right branch of computation
 */
export const switchK = <F extends URIS>(M: Monad1<F>) =>
  <A, B, C>(l: Kleisli<F, A, B>, r: Kleisli<F, C, B>): Kleisli<F, Either<A, C>, B> =>
    isImpure(l) && isImpure(r) ?
      new Impure<F, Either<A, C>, B>(M, (a) => pipe(
        a,
        fold(
          (al) => l._run(al),
          (ar) => r._run(ar),
        )),
      ) :
      pure(M)((a) => pipe(
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
export const zipWith = <F extends URIS>(M: Monad1<F>) =>
  <A, B, C, D>(l: Kleisli<F, A, B>, r: Kleisli<F, A, C>) =>
    (f: (t: [B, C]) => D): Kleisli<F, A, D> =>
      isImpure(l) && isImpure(r) ?
        new Impure<F, A, D>(M, (a) => f([l._run(a), r._run(a)])) :
        pure(M)((a) => M.chain(l.run(a), (b) => M.map(r.run(a), (c) => f([b, c]))));

/**
 * Propagate the input unchanged.
 */
export const identity = <F extends URIS>(M: Monad1<F>) =>
  <A>(): Kleisli<F, A, A> => liftK(M)((x) => x);

/**
 * Execute either the `k` computation or propagate the value of type `C` through, depending on an input.
 * A flipped version of @see right.
 * @param k Computation from `A` to `B`
 */
export const left = <F extends URIS>(M: Monad1<F>) =>
  <A, B, C>(k: Kleisli<F, A, B>): Kleisli<F, Either<A, C>, Either<B, C>> =>
    isImpure(k) ?
      new Impure(M, (a) => pipe(a, fold(
        (l) => eitherLeft(k._run(l)),
        (r) => eitherRight(r),
      ))) :
      pure(M)((a) => pipe(a, fold(
        (l) => M.map(k.run(l), (x) => eitherLeft(x)),
        (r) => M.of(eitherRight(r)),
      )));

/**
 * Execute either the `k` computation or propagate the value of type `C` through, depending on an input.
 * A flipped version of @see left.
 * @param k Computation from `A` to `B`
 */
export const right = <F extends URIS>(M: Monad1<F>) =>
  <A, B, C>(k: Kleisli<F, A, B>): Kleisli<F, Either<C, A>, Either<C, B>> =>
    isImpure(k) ?
      new Impure(M, (a) => pipe(a, fold(
        (l) => eitherLeft(l),
        (r) => eitherRight(k._run(r)),
      ))) :
      pure(M)((a) => pipe(a, fold(
        (l) => M.of(eitherLeft(l)),
        (r) => M.map(k.run(r), (x) => eitherRight(x)),
      )));

/**
 * Depending on the condition, propagate the original input through the left or right part of `Either`.
 * @param cond Predicate for `A`
 */
export const test = <F extends URIS>(M: Monad1<F>) =>
  <A>(cond: Kleisli<F, A, boolean>): Kleisli<F, A, Either<A, A>> =>
    cond.both(identity(M)()).andThen(liftK(M)(([c, a]) => c ? eitherLeft(a) : eitherRight(a)));

/**
 * Depending on the condition, execute either `then` or `else`.
 * @param cond Predicate for `A`
 * @param then Computation to run if `cond` is `true`
 * @param else_ Computation to run if `cond` is `false`
 */
export const ifThenElse = <F extends URIS>(M: Monad1<F>) =>
  <A, B>(cond: Kleisli<F, A, boolean>) =>
    (then: Kleisli<F, A, B>) => (else_: Kleisli<F, A, B>): Kleisli<F, A, B> =>
      isImpure(cond) && isImpure(then) && isImpure(else_) ?
        new Impure(M, (a) => cond._run(a) ? then._run(a) : else_._run(a)) :
        test(M)(cond).andThen(switchK(M)(then, else_));

/**
 * Simplified version of @see ifThenElse without the `else` part.
 * @param cond Predicate for `A`
 * @param then Computation to run if `cond` is `true`
 */
export const ifThen = <F extends URIS>(M: Monad1<F>) =>
  <A>(cond: Kleisli<F, A, boolean>) =>
    (then: Kleisli<F, A, A>): Kleisli<F, A, A> => ifThenElse(M)<A, A>(cond)(then)(identity(M)());

/**
 * While-loop: run `body` until `cond` is `true`.
 * @param cond Predicate for `A`
 * @param body Computation to run continuously until `cond` is `false`
 */
export const whileDo = <F extends URIS>(M: Monad1<F>) =>
  <A>(cond: Kleisli<F, A, boolean>) => (body: Kleisli<F, A, A>): Kleisli<F, A, A> => {
    if (isImpure(cond) && isImpure(body)) {
      return new Impure<F, A, A>(
        M,
        (a0) => {
          let a = a0;

          while (cond._run(a)) {
            a = body._run(a);
          }

          return a;
        },
      );
    } else {
      const loop = (): Kleisli<F, A, A> =>
        pure(M)<A, A>((a) => M.chain(cond.run(a), (b) => b ? M.chain(body.run(a), loop().run) : M.of(a)));

      return loop();
    }
  };

/**
 * Lifted version of `fst` tuple function.
 */
export const fst = <F extends URIS>(M: Monad1<F>) =>
  <A, B>(): Kleisli<F, [A, B], A> => liftK(M)(([a]) => a);

/**
 * Lifted version of `snd` tuple function.
 */
export const snd = <F extends URIS>(M: Monad1<F>) =>
  <A, B>(): Kleisli<F, [A, B], B> => liftK(M)(([, b]) => b);

/**
 * Convenience method which retruns instances of Kleisli API for the given monad.
 * @param M Monad1 & Bifunctor instance
 */
export const getInstancesFor = <F extends URIS>(M: Monad1<F>) => ({
  /**
   * Applicative `of` function.
   * Lift a value of type `B` into a context of `Kleisli`.
   * @param b Value of type `B`
   */
  of: of(M),
  /**
   * Create a new instance of `Pure` computation.
   * @param f Function to run
   */
  pure: pure(M),
  /**
   * Create a new instance of `Impure` computation.
   * @param catcher Function to transform the error from `Error` into `E`
   * @param f Impure computation from `A` to `B` which may throw
   */
  impure: impure(M),
  /**
   * Create a new `Kleisli` computation from impure function which *you know* to never throw exceptions,
   * or throw exceptions which should lead to termination fo the program.
   * @param f Impure computation from `A` to `B`
   */
  impureVoid: impureVoid(M),
  /**
   * Lift the impure computation into `Kleisli` context.
   * @param f Impure function from `A` to `B`
   */
  liftK: liftK(M),
  /**
   * Monadic `chain` function.
   * Apply function `f` to the result of current `Kleisli<F, A, B>`, determining the next flow of computations.
   * @param fa Basic Kleisli computation
   * @param f Function from `B` to `Kleisli<F, A, C>`, which represents next sequential computation
   */
  chain: chain(M),
  /**
   * Create a new `Kleisli` computation which result in `b`.
   * @param b Lazy value of type `B`
   */
  point: point(M),
  /**
   * Tuple swap, lifted in `Kleisli` context.
   */
  swap: swap(M),
  /**
   * Perform right-to-left Kleisli arrows compotions.
   * @param second Second computation to apply
   * @param first First computation to apply
   */
  composeK: composeK(M),
  /**
   * Perform left-to-right Kleisli arrows compotions.
   * @param first First computation to apply
   * @param second Second computation to apply
   */
  pipeK: pipeK(M),
  /**
   * Depending on the input of type `Either<A, C>`, execute either `l` or `r` branches.
   * @param l Left branch of computation
   * @param r Right branch of computation
   */
  switchK: switchK(M),
  /**
   * Execute `l` and `r` computations and if both succeed, process the results with `f`.
   * @param l First `Kleisli` computation
   * @param r Second `Kleisli` computation
   * @param f Function to process the results of both computations
   */
  zipWith: zipWith(M),
  /**
   * Propagate the input unchanged.
   */
  identity: identity(M),
  /**
   * Execute either the `k` computation or propagate the value of type `C` through, depending on an input.
   * A flipped version of @see right.
   * @param k Computation from `A` to `B`
   */
  left: left(M),
  /**
   * Execute either the `k` computation or propagate the value of type `C` through, depending on an input.
   * A flipped version of @see left.
   * @param k Computation from `A` to `B`
   */
  right: right(M),
  /**
   * Depending on the condition, propagate the original input through the left or right part of `Either`.
   * @param cond Predicate for `A`
   */
  test: test(M),
  /**
   * Depending on the condition, execute either `then` or `else`.
   * @param cond Predicate for `A`
   * @param then Computation to run if `cond` is `true`
   * @param else_ Computation to run if `cond` is `false`
   */
  ifThenElse: ifThenElse(M),
  /**
   * Simplified version of @see ifThenElse without the `else` part.
   * @param cond Predicate for `A`
   * @param then Computation to run if `cond` is `true`
   */
  ifThen: ifThen(M),
  /**
   * While-loop: run `body` until `cond` is `true`.
   * @param cond Predicate for `A`
   * @param body Computation to run continuously until `cond` is `false`
   */
  whileDo: whileDo(M),
  /**
   * Lifted version of `fst` tuple function.
   */
  fst: fst(M),
  /**
   * Lifted version of `snd` tuple function.
   */
  snd: snd(M),
});

export default getInstancesFor;
