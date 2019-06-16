// tslint:disable:max-line-length
/*
 *  Copyright 2019 Yuriy Bogomolov
 *
 *  Licensed under the Apache License, Version 2.0 (the "License");
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
 *
 * TypeScript port of John A. De Goes's talk about KleisliIO at LambdaConf'18:
 * https://www.youtube.com/watch?v=L8AEj6IRNEE
 * with additional instances of Applicative, Bifunctor, etc.
 * Original implementation in Scala can be found in this commit:
 * https://github.com/zio/zio/blob/c5c3f47c163c7638886205fefbadf43f7553751e/shared/src/main/scala/scalaz/effect/KleisliIO.scala
 */
// tslint:enable:max-line-length

import { Bifunctor2 } from 'fp-ts/lib/Bifunctor';
import { Either, left as eitherLeft, right as eitherRight } from 'fp-ts/lib/Either';
import { compose } from 'fp-ts/lib/function';
import { Type2, URIS2 } from 'fp-ts/lib/HKT';
import { MonadThrow2 } from 'fp-ts/lib/MonadThrow';

/**
 * KleisliIO – an effectful function from `A` to `Type2<F, E, B>`.
 * For more intuition about Kleisli arrows please @see http://www.cse.chalmers.se/~rjmh/Papers/arrows.pdf
 *
 * @template A domain type
 * @template E error type of codomain
 * @template B value type of codomain
 */
export abstract class KleisliIO<F extends URIS2, E, A, B> {
  abstract tag: 'Pure' | 'Impure' | 'Compose';

  /**
   * Executes current `KleisliIO`, yielding IO of either ann error of type `E` or value of type `B`.
   * @param a Value of type `A`
   */
  abstract run(a: A): Type2<F, E, B>;

  abstract M: MonadThrow2<F> & Bifunctor2<F>;

  /**
   * Applicative `ap` function.
   * Apply a lifted in `KleisliIO` context function to current value of `KleisliIO`.
   * @param fbc Function from `B` to `C`, lifted in the context of `KleisliIO`
   */
  ap<C>(fbc: KleisliIO<F, E, A, (b: B) => C>): KleisliIO<F, E, A, C> {
    return pure(this.M)((a) => this.M.ap(fbc.run(a), this.run(a)));
  }

  /**
   * Functorial `map` function.
   * Lift the passed function `f` into a context of `KleisliIO`.
   * @param f Function from `B` to `C` to transform the encapsulated value
   */
  map<C>(f: (b: B) => C): KleisliIO<F, E, A, C> {
    return this.andThen(liftK(this.M)(f));
  }

  /**
   * Monadic `chain` function.
   * Apply function `f` to the result of current `KleisliIO<F, E, A, B>`, determining the next flow of computations.
   * @param f Function from `B` to `KleisliIO<F, E, A, C>`, which represents next sequential computation.
   */
  chain<C>(f: (b: B) => KleisliIO<F, E, A, C>) {
    return pure(this.M)<E, A, C>((a) => this.M.chain(this.run(a), (b) => f(b).run(a)));
  }

  /**
   * Bifunctorial `bimap` function.
   * Take two functions to transform both error and value parts simultaneously.
   * @param f Function to transform the error part
   * @param g Function to transform the value part
   */
  bimap<E1, C>(f: (e: E) => E1, g: (b: B) => C): KleisliIO<F, E1, A, C> {
    return pure(this.M)((a) => this.M.bimap(this.run(a), f, g));
  }

  /**
   * Compose current `KleisliIO` with the next one.
   * @param that Sequential `KleisliIO` computation
   */
  andThen<C>(that: KleisliIO<F, E, B, C>): KleisliIO<F, E, A, C> {
    return composeK(this.M)(that, this);
  }

  /**
   * Execute `this` and `that` computations and if both succeed, process the results with `f`.
   * @see both
   * @param that Second `KleisliIO` computation to run alongside with current
   * @param f Function to process the results of both computations
   */
  zipWith<C, D>(that: KleisliIO<F, E, A, C>): (f: (t: [B, C]) => D) => KleisliIO<F, E, A, D> {
    return (f) => zipWith(this.M)<E, A, B, C, D>(this, that)(f);
  }

  /**
   * Execute `this` and `that` computations and return a tuple of results.
   * @see zipWith
   * @param that Second `KleisliIO` computation to run alongside with current
   */
  both<C>(that: KleisliIO<F, E, A, C>): KleisliIO<F, E, A, [B, C]> {
    return zipWith(this.M)<E, A, B, C, [B, C]>(this, that)((x) => x);
  }

  /**
   * Depending on an input, run ether `this` or `that` computation.
   * @param that Alternative computation
   */
  join<C>(that: KleisliIO<F, E, C, B>): KleisliIO<F, E, Either<A, C>, B> {
    return switchK(this.M)(this, that);
  }

  /**
   * Pass the original imput of type `A` alongside with the result of computation of type `B`, which comes *first*.
   */
  first(): KleisliIO<F, E, A, [B, A]> {
    return this.both(identity(this.M)<E, A>());
  }

  /**
   * Pass the original imput of type `A` alongside with the result of computation of type `B`, which comes *second*.
   */
  second(): KleisliIO<F, E, A, [A, B]> {
    return identity(this.M)<E, A>().both(this);
  }

  /**
   * Discard the results of `this` computation and return `c`.
   * @param c Value of type `C` to return
   */
  constant<C>(c: C): KleisliIO<F, E, A, C> {
    return this.andThen(liftK(this.M)(() => c));
  }

  /**
   * Discard the results of `this` computation.
   */
  toVoid(): KleisliIO<F, E, A, void> {
    return this.constant(void 0);
  }

  /**
   * Discard the results of `this` computation and propagate the original input.
   * Effectively just keep the effect of `this` computation.
   */
  asEffect(): KleisliIO<F, E, A, A> {
    return this.first().andThen(snd(this.M)());
  }
}

/**
 * Specialized error type for KleisliIO
 */
class KleisliIOError<E> extends Error {
  constructor(readonly error: E) { super(String(error)); }
}

/**
 * A pure functional computation from `A` to `Type2<F, E, B>`, which **never** throws in runtime.
 *
 * @see KleisliIO
 *
 * @template A domain type
 * @template E error type of codomain
 * @template B value type of codomain
 */
class Pure<F extends URIS2, E, A, B> extends KleisliIO<F, E, A, B> {
  readonly tag = 'Pure';
  constructor(readonly M: MonadThrow2<F> & Bifunctor2<F>, readonly _run: (a: A) => Type2<F, E, B>) { super(); }

  run = (a: A): Type2<F, E, B> => this._run(a);
}

/**
 * An impure effectful computation from `A` to `B`, which may throw an exception of type `E`
 *
 * @see KleisliIO
 *
 * @template A domain type
 * @template E error type of codomain
 * @template B value type of codomain
 */
class Impure<F extends URIS2, E, A, B> extends KleisliIO<F, E, A, B> {
  readonly tag = 'Impure';
  constructor(readonly M: MonadThrow2<F> & Bifunctor2<F>, readonly _run: (a: A) => B) { super(); }

  run = (a: A): Type2<F, E, B> => {
    try {
      const b = this._run(a);
      return this.M.of(b);
    } catch (e) {
      if (e instanceof KleisliIOError) {
        return this.M.throwError(e.error);
      }
      throw e;
    }
  }
}

/**
 * A right-to-left composition of two KleisliIO functions.
 *
 * @see KleisliIO
 *
 * @template A domain type
 * @template E error type of codomain
 * @template B value type of codomain
 */
class Compose<F extends URIS2, E, A, B, C> extends KleisliIO<F, E, A, C> {
  readonly tag = 'Compose';
  constructor(
    readonly M: MonadThrow2<F> & Bifunctor2<F>,
    readonly g: KleisliIO<F, E, B, C>,
    readonly f: KleisliIO<F, E, A, B>,
  ) { super(); }

  run = (a: A): Type2<F, E, C> => this.M.chain(this.f.run(a), this.g.run);
}

const isImpure = <F extends URIS2, E, A, B>(a: KleisliIO<F, E, A, B>): a is Impure<F, E, A, B> => a.tag === 'Impure';

/**
 * Create a new instance of `Pure` computation.
 * @param f Function to run
 */
export const pure = <F extends URIS2>(M: MonadThrow2<F> & Bifunctor2<F>) =>
  <E, A, B>(f: (a: A) => Type2<F, E, B>): KleisliIO<F, E, A, B> => new Pure<F, E, A, B>(M, f);

/**
 * Create a new instance of `Impure` computation.
 * @param catcher Function to transform the error from `Error` into `E`
 * @param f Impure computation from `A` to `B` which may throw
 */
export const impure = <F extends URIS2>(M: MonadThrow2<F> & Bifunctor2<F>) =>
  <E>(catcher: (e: Error) => E) => <A, B>(f: (a: A) => B): KleisliIO<F, E, A, B> => new Impure(
    M,
    (a: A) => {
      try {
        return f(a);
      } catch (error) {
        if (catcher(error) !== undefined) {
          throw new KleisliIOError<E>(catcher(error));
        }
        throw error;
      }
    },
  );

const voidCatcher = (e: Error): never => { throw e; };

/**
 * Create a new `KleisliIO` computation from impure function which *you know* to never throw exceptions,
 * or throw exceptions which should lead to termination fo the program.
 * @param f Impure computation from `A` to `B`
 */
export const impureVoid = <F extends URIS2>(M: MonadThrow2<F> & Bifunctor2<F>) =>
  <A, B>(f: (a: A) => B): KleisliIO<F, never, A, B> => impure(M)(voidCatcher)(f);

/**
 * Lift the impure computation into `KleisliIO` context.
 * @param f Impure function from `A` to `B`
 */
export const liftK = <F extends URIS2>(M: MonadThrow2<F> & Bifunctor2<F>) =>
  <E, A, B>(f: (a: A) => B): KleisliIO<F, E, A, B> => new Impure(M, f);

/**
 * Monadic `chain` function.
 * Apply function `f` to the result of current `KleisliIO<F, E, A, B>`, determining the next flow of computations.
 * @param fa Basic KleisliIO computation
 * @param f Function from `B` to `KleisliIO<F, E, A, C>`, which represents next sequential computation
 */
export const chain = <F extends URIS2>(M: MonadThrow2<F> & Bifunctor2<F>) =>
  <E, A, B, C>(fa: KleisliIO<F, E, A, B>, f: (b: B) => KleisliIO<F, E, A, C>): KleisliIO<F, E, A, C> =>
    pure(M)<E, A, C>((a) => M.chain(fa.run(a), (b) => f(b).run(a)));

/**
 * Create a new `KleisliIO` computation which result in `b`.
 * @param b Lazy value of type `B`
 */
export const point = <F extends URIS2>(M: MonadThrow2<F> & Bifunctor2<F>) =>
  <E, A, B>(b: () => B): KleisliIO<F, E, A, B> => liftK(M)(b);

/**
 * Applicative `of` function.
 * Lift a value of type `B` into a context of `KleisliIO`.
 * @param b Value of type `B`
 */
export const of = <F extends URIS2>(M: MonadThrow2<F> & Bifunctor2<F>) =>
  <E, A, B>(b: B): KleisliIO<F, E, A, B> => liftK(M)(() => b);

/**
 * Fail with an error of type `E`.
 * @param e Error of type `E`
 */
export const fail = <F extends URIS2>(M: MonadThrow2<F> & Bifunctor2<F>) =>
  <E, A, B>(e: E): KleisliIO<F, E, A, B> => new Impure(M, () => { throw new KleisliIOError(e); });

/**
 * Tuple swap, lifted in `KleisliIO` context.
 */
export const swap = <F extends URIS2>(M: MonadThrow2<F> & Bifunctor2<F>) =>
  <E, A, B>(): KleisliIO<F, E, [A, B], [B, A]> => liftK(M)(([a, b]) => [b, a]);

/**
 * Perform right-to-left Kleisli arrows compotions.
 * @param second Second computation to apply
 * @param first First computation to apply
 */
export const composeK = <F extends URIS2>(M: MonadThrow2<F> & Bifunctor2<F>) =>
  <E, A, B, C>(second: KleisliIO<F, E, B, C>, first: KleisliIO<F, E, A, B>): KleisliIO<F, E, A, C> =>
    isImpure(second) && isImpure(first) ?
      new Impure(M, compose(second._run, first._run)) :
      new Compose(M, second, first);

/**
 * Perform left-to-right Kleisli arrows compotions.
 * @param first First computation to apply
 * @param second Second computation to apply
 */
export const pipeK = <F extends URIS2>(M: MonadThrow2<F> & Bifunctor2<F>) =>
  <E, A, B, C>(first: KleisliIO<F, E, A, B>, second: KleisliIO<F, E, B, C>): KleisliIO<F, E, A, C> =>
    composeK(M)(second, first);

/**
 * Depending on the input of type `Either<A, C>`, execute either `l` or `r` branches.
 * @param l Left branch of computation
 * @param r Right branch of computation
 */
export const switchK = <F extends URIS2>(M: MonadThrow2<F> & Bifunctor2<F>) =>
  <E, A, B, C>(l: KleisliIO<F, E, A, B>, r: KleisliIO<F, E, C, B>): KleisliIO<F, E, Either<A, C>, B> =>
    isImpure(l) && isImpure(r) ?
      new Impure<F, E, Either<A, C>, B>(M, (a) => a.fold(
        (al) => l._run(al),
        (ar) => r._run(ar),
      )) :
      pure(M)((a) => a.fold(
        (al) => l.run(al),
        (ar) => r.run(ar),
      ));

/**
 * Execute `l` and `r` computations and if both succeed, process the results with `f`.
 * @param l First `KleisliIO` computation
 * @param r Second `KleisliIO` computation
 * @param f Function to process the results of both computations
 */
export const zipWith = <F extends URIS2>(M: MonadThrow2<F> & Bifunctor2<F>) =>
  <E, A, B, C, D>(l: KleisliIO<F, E, A, B>, r: KleisliIO<F, E, A, C>) =>
    (f: (t: [B, C]) => D): KleisliIO<F, E, A, D> =>
      isImpure(l) && isImpure(r) ?
        new Impure<F, E, A, D>(M, (a) => f([l._run(a), r._run(a)])) :
        pure(M)((a) => M.chain(l.run(a), (b) => M.map(r.run(a), (c) => f([b, c]))));

/**
 * Propagate the input unchanged.
 */
export const identity = <F extends URIS2>(M: MonadThrow2<F> & Bifunctor2<F>) =>
  <E, A>(): KleisliIO<F, E, A, A> => liftK(M)((x) => x);

/**
 * Execute either the `k` computation or propagate the value of type `C` through, depending on an input.
 * A flipped version of @see right.
 * @param k Computation from `A` to `B`
 */
export const left = <F extends URIS2>(M: MonadThrow2<F> & Bifunctor2<F>) =>
  <E, A, B, C>(k: KleisliIO<F, E, A, B>): KleisliIO<F, E, Either<A, C>, Either<B, C>> =>
    isImpure(k) ?
      new Impure(M, (a) => a.fold(
        (l) => eitherLeft(k._run(l)),
        (r) => eitherRight(r),
      )) :
      pure(M)((a) => a.fold(
        (l) => M.map(k.run(l), (x) => eitherLeft(x)),
        (r) => M.of(eitherRight(r)),
      ));

/**
 * Execute either the `k` computation or propagate the value of type `C` through, depending on an input.
 * A flipped version of @see left.
 * @param k Computation from `A` to `B`
 */
export const right = <F extends URIS2>(M: MonadThrow2<F> & Bifunctor2<F>) =>
  <E, A, B, C>(k: KleisliIO<F, E, A, B>): KleisliIO<F, E, Either<C, A>, Either<C, B>> =>
    isImpure(k) ?
      new Impure(M, (a) => a.fold(
        (l) => eitherLeft(l),
        (r) => eitherRight(k._run(r)),
      )) :
      pure(M)((a) => a.fold(
        (l) => M.of(eitherLeft(l)),
        (r) => M.map(k.run(r), (x) => eitherRight(x)),
      ));

/**
 * Depending on the condition, propagate the original input through the left or right part of `Either`.
 * @param cond Predicate for `A`
 */
export const test = <F extends URIS2>(M: MonadThrow2<F> & Bifunctor2<F>) =>
  <E, A>(cond: KleisliIO<F, E, A, boolean>): KleisliIO<F, E, A, Either<A, A>> =>
    cond.both(identity(M)()).andThen(liftK(M)(([c, a]) => c ? eitherLeft(a) : eitherRight(a)));

/**
 * Depending on the condition, execute either `then` or `else`.
 * @param cond Predicate for `A`
 * @param then Computation to run if `cond` is `true`
 * @param else_ Computation to run if `cond` is `false`
 */
export const ifThenElse = <F extends URIS2>(M: MonadThrow2<F> & Bifunctor2<F>) =>
  <E, A, B>(cond: KleisliIO<F, E, A, boolean>) =>
    (then: KleisliIO<F, E, A, B>) => (else_: KleisliIO<F, E, A, B>): KleisliIO<F, E, A, B> =>
      isImpure(cond) && isImpure(then) && isImpure(else_) ?
        new Impure(M, (a) => cond._run(a) ? then._run(a) : else_._run(a)) :
        test(M)(cond).andThen(switchK(M)(then, else_));

/**
 * Simplified version of @see ifThenElse without the `else` part.
 * @param cond Predicate for `A`
 * @param then Computation to run if `cond` is `true`
 */
export const ifThen = <F extends URIS2>(M: MonadThrow2<F> & Bifunctor2<F>) =>
  <E, A>(cond: KleisliIO<F, E, A, boolean>) =>
    (then: KleisliIO<F, E, A, A>): KleisliIO<F, E, A, A> => ifThenElse(M)<E, A, A>(cond)(then)(identity(M)());

/**
 * While-loop: run `body` until `cond` is `true`.
 * @param cond Predicate for `A`
 * @param body Computation to run continuously until `cond` is `false`
 */
export const whileDo = <F extends URIS2>(M: MonadThrow2<F> & Bifunctor2<F>) =>
  <E, A>(cond: KleisliIO<F, E, A, boolean>) => (body: KleisliIO<F, E, A, A>): KleisliIO<F, E, A, A> => {
    if (isImpure(cond) && isImpure(body)) {
      return new Impure<F, E, A, A>(
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
      const loop = (): KleisliIO<F, E, A, A> =>
        pure(M)<E, A, A>((a) => M.chain(cond.run(a), (b) => b ? M.chain(body.run(a), loop().run) : M.of(a)));

      return loop();
    }
  };

/**
 * Lifted version of `fst` tuple function.
 */
export const fst = <F extends URIS2>(M: MonadThrow2<F> & Bifunctor2<F>) =>
  <E, A, B>(): KleisliIO<F, E, [A, B], A> => liftK(M)(([a]) => a);

/**
 * Lifted version of `snd` tuple function.
 */
export const snd = <F extends URIS2>(M: MonadThrow2<F> & Bifunctor2<F>) =>
  <E, A, B>(): KleisliIO<F, E, [A, B], B> => liftK(M)(([, b]) => b);

/**
 * Convenience method which retruns instances of KleisliIO API for the given monad.
 * @param M MonadThrow & Bifunctor instance
 */
export const getInstancesFor = <F extends URIS2>(M: MonadThrow2<F> & Bifunctor2<F>) => ({
  /**
   * Applicative `of` function.
   * Lift a value of type `B` into a context of `KleisliIO`.
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
   * Create a new `KleisliIO` computation from impure function which *you know* to never throw exceptions,
   * or throw exceptions which should lead to termination fo the program.
   * @param f Impure computation from `A` to `B`
   */
  impureVoid: impureVoid(M),
  /**
   * Lift the impure computation into `KleisliIO` context.
   * @param f Impure function from `A` to `B`
   */
  liftK: liftK(M),
  /**
   * Monadic `chain` function.
   * Apply function `f` to the result of current `KleisliIO<F, E, A, B>`, determining the next flow of computations.
   * @param fa Basic KleisliIO computation
   * @param f Function from `B` to `KleisliIO<F, E, A, C>`, which represents next sequential computation
   */
  chain: chain(M),
  /**
   * Create a new `KleisliIO` computation which result in `b`.
   * @param b Lazy value of type `B`
   */
  point: point(M),
  /**
   * Fail with an error of type `E`.
   * @param e Error of type `E`
   */
  fail: fail(M),
  /**
   * Tuple swap, lifted in `KleisliIO` context.
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
   * @param l First `KleisliIO` computation
   * @param r Second `KleisliIO` computation
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
