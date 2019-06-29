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

import { Comonad2 } from 'fp-ts/lib/Comonad';
import { Either, fold, left as eitherLeft, right as eitherRight } from 'fp-ts/lib/Either';
import { flow } from 'fp-ts/lib/function';
import { Kind2, URIS2 } from 'fp-ts/lib/HKT';
import { Monad2 } from 'fp-ts/lib/Monad';
import { pipe } from 'fp-ts/lib/pipeable';

import { Distributes22 } from './Distributes';
import { KleisliError } from './error';

/**
 * BiKleisliIO – an effectful function from `Kind<F, E, A>` to `Kind2<G, E, B>`.
 * For more intuition about Kleisli arrows please @see http://www.cse.chalmers.se/~rjmh/Papers/arrows.pdf
 *
 * @template E error type
 * @template A domain type
 * @template B codomain type
 */
export abstract class BiKleisliIO<F extends URIS2, G extends URIS2, E, A, B> {
  abstract tag: 'Pure' | 'Impure' | 'Compose';

  /**
   * Executes current `BiKleisliIO`, yielding IO of either ann error of type `E` or value of type `B`.
   * @param a Value of type `Kind<F, E, A>`
   */
  abstract run(a: Kind2<F, E, A>): Kind2<G, E, B>;

  abstract W: Comonad2<F>;
  abstract M: Monad2<G>;
  abstract T: Distributes22<F, G>;

  /**
   * Applicative `ap` function.
   * Apply a lifted in `BiKleisliIO` context function to current value of `BiKleisliIO`.
   * @param fbc Function from `B` to `C`, lifted in the context of `BiKleisliIO`
   */
  ap<C>(fbc: BiKleisliIO<F, G, E, A, (b: B) => C>): BiKleisliIO<F, G, E, A, C> {
    return pure(this.W, this.M, this.T)((a) => this.M.ap(fbc.run(a), this.run(a)));
  }

  /**
   * Functorial `map` function.
   * Lift the passed function `f` into a context of `BiKleisliIO`.
   * @param f Function from `B` to `C` to transform the encapsulated value
   */
  map<C>(f: (b: B) => C): BiKleisliIO<F, G, E, A, C> {
    return this.andThen(liftK(this.W, this.M, this.T)(f));
  }

  /**
   * Monadic `chain` function.
   * Apply function `f` to the result of current `BiKleisliIO<F, G, E, A, B>`,
   * determining the next flow of computations.
   * @param f Function from `B` to `BiKleisliIO<F, G, E, A, C>`, which represents next sequential computation.
   */
  chain<C>(f: (b: B) => BiKleisliIO<F, G, E, A, C>) {
    return pure(this.W, this.M, this.T)<E, A, C>((a) => this.M.chain(this.run(a), (b) => f(b).run(a)));
  }

  /**
   * Compose current `BiKleisliIO` with the next one.
   * @param that Sequential `BiKleisliIO` computation
   */
  andThen<C>(that: BiKleisliIO<F, G, E, B, C>): BiKleisliIO<F, G, E, A, C> {
    return composeK(this.W, this.M, this.T)(that, this);
  }

  /**
   * Execute `this` and `that` computations and if both succeed, process the results with `f`.
   * @see both
   * @param that Second `BiKleisliIO` computation to run alongside with current
   * @param f Function to process the results of both computations
   */
  zipWith<C, D>(that: BiKleisliIO<F, G, E, A, C>): (f: (t: [B, C]) => D) => BiKleisliIO<F, G, E, A, D> {
    return (f) => zipWith(this.W, this.M, this.T)<E, A, B, C, D>(this, that)(f);
  }

  /**
   * Execute `this` and `that` computations and return a tuple of results.
   * @see zipWith
   * @param that Second `BiKleisliIO` computation to run alongside with current
   */
  both<C>(that: BiKleisliIO<F, G, E, A, C>): BiKleisliIO<F, G, E, A, [B, C]> {
    return zipWith(this.W, this.M, this.T)<E, A, B, C, [B, C]>(this, that)((x) => x);
  }

  /**
   * Depending on an input, run ether `this` or `that` computation.
   * @param that Alternative computation
   */
  join<C>(that: BiKleisliIO<F, G, E, C, B>): BiKleisliIO<F, G, E, Either<A, C>, B> {
    return switchK(this.W, this.M, this.T)(this, that);
  }

  /**
   * Pass the original imput of type `A` alongside with the result of computation of type `B`, which comes *first*.
   */
  first(): BiKleisliIO<F, G, E, A, [B, A]> {
    return this.both(identity(this.W, this.M, this.T)<E, A>());
  }

  /**
   * Pass the original imput of type `A` alongside with the result of computation of type `B`, which comes *second*.
   */
  second(): BiKleisliIO<F, G, E, A, [A, B]> {
    return identity(this.W, this.M, this.T)<E, A>().both(this);
  }

  /**
   * Discard the results of `this` computation and return `c`.
   * @param c Value of type `C` to return
   */
  constant<C>(c: C): BiKleisliIO<F, G, E, A, C> {
    return this.andThen(liftK(this.W, this.M, this.T)(() => c));
  }

  /**
   * Discard the results of `this` computation.
   */
  toVoid(): BiKleisliIO<F, G, E, A, void> {
    return this.constant(void 0);
  }

  /**
   * Discard the results of `this` computation and propagate the original input.
   * Effectively just keep the effect of `this` computation.
   */
  asEffect(): BiKleisliIO<F, G, E, A, A> {
    return this.first().andThen(snd(this.W, this.M, this.T)());
  }
}

/**
 * A pure functional computation from `A` to `Kind2<F, B>`, which **never** throws in runtime.
 *
 * @see Kleisli
 *
 * @template A domain type
 * @template B codomain type
 */
class Pure<F extends URIS2, G extends URIS2, E, A, B> extends BiKleisliIO<F, G, E, A, B> {
  readonly tag = 'Pure';
  constructor(
    readonly W: Comonad2<F>,
    readonly M: Monad2<G>,
    readonly T: Distributes22<F, G>,
    readonly _run: (a: Kind2<F, E, A>) => Kind2<G, E, B>,
  ) { super(); }

  run = (fa: Kind2<F, E, A>): Kind2<G, E, B> => this._run(fa);
}

/**
 * An impure effectful computation from `A` to `B`, which may throw an exception of type `E`
 *
 * @see Kleisli
 *
 * @template A domain type
 * @template B codomain type
 */
class Impure<F extends URIS2, G extends URIS2, E, A, B> extends BiKleisliIO<F, G, E, A, B> {
  readonly tag = 'Impure';
  constructor(
    readonly W: Comonad2<F>,
    readonly M: Monad2<G>,
    readonly T: Distributes22<F, G>,
    readonly _run: (a: A) => B,
  ) { super(); }

  run = (fa: Kind2<F, E, A>): Kind2<G, E, B> => this.M.of(this._run(this.W.extract(fa)));
}

/**
 * A right-to-left composition of two Kleisli functions.
 *
 * @see Kleisli
 *
 * @template A domain type
 * @template B codomain type
 */
class Compose<F extends URIS2, G extends URIS2, E, A, B, C> extends BiKleisliIO<F, G, E, A, C> {
  readonly tag = 'Compose';
  constructor(
    readonly W: Comonad2<F>,
    readonly M: Monad2<G>,
    readonly T: Distributes22<F, G>,
    readonly f: BiKleisliIO<F, G, E, A, B>,
    readonly g: BiKleisliIO<F, G, E, B, C>,
  ) { super(); }

  run = (fa: Kind2<F, E, A>): Kind2<G, E, C> =>
    this.M.chain(this.T(this.W.extend(fa, this.f.run)), (fb) => this.g.run(fb))
}

function isImpure<F extends URIS2, G extends URIS2, E, A, B>(
  a: BiKleisliIO<F, G, E, A, B>,
): a is Impure<F, G, E, A, B> {
  return a.tag === 'Impure';
}

/**
 * Create a new instance of `Pure` computation.
 * @param f Function to run
 */
export function pure<F extends URIS2, G extends URIS2>(W: Comonad2<F>, M: Monad2<G>, T: Distributes22<F, G>) {
  return <E, A, B>(f: (a: Kind2<F, E, A>) => Kind2<G, E, B>): BiKleisliIO<F, G, E, A, B> =>
    new Pure<F, G, E, A, B>(W, M, T, f);
}

/**
 * Create a new instance of `Impure` computation.
 * @param catcher Function to transform the error from `Error` into `E`
 * @param f Impure computation from `A` to `B` which may throw
 */
export function impure<F extends URIS2, G extends URIS2>(W: Comonad2<F>, M: Monad2<G>, T: Distributes22<F, G>) {
  return <E>(catcher: (e: Error) => E) => <A, B>(f: (a: A) => B): BiKleisliIO<F, G, E, A, B> =>
    new Impure(W, M, T, (a: A) => {
      try {
        return f(a);
      } catch (error) {
        if (catcher(error) !== undefined) {
          throw new KleisliError<E>(catcher(error));
        }
        throw error;
      }
    });
}

const voidCatcher = (e: Error): never => { throw e; };

/**
 * Create a new `BiKleisliIO` computation from impure function which *you know* to never throw exceptions,
 * or throw exceptions which should lead to termination fo the program.
 * @param f Impure computation from `A` to `B`
 */
export function impureVoid<F extends URIS2, G extends URIS2>(W: Comonad2<F>, M: Monad2<G>, T: Distributes22<F, G>) {
  return <E, A, B>(f: (a: A) => B): BiKleisliIO<F, G, E, A, B> => impure(W, M, T)(voidCatcher)(f);
}

/**
 * Lift the impure computation into `BiKleisliIO` context.
 * @param f Impure function from `A` to `B`
 */
export function liftK<F extends URIS2, G extends URIS2>(W: Comonad2<F>, M: Monad2<G>, T: Distributes22<F, G>) {
  return <E, A, B>(f: (a: A) => B): BiKleisliIO<F, G, E, A, B> => new Impure(W, M, T, f);
}

/**
 * Monadic `chain` function.
 * Apply function `f` to the result of current `BiKleisliIO<F, G, E, A, B>`, determining the next flow of computations.
 * @param fa Basic Kleisli computation
 * @param f Function from `B` to `BiKleisliIO<F, G, E, A, C>`, which represents next sequential computation
 */
export function chain<F extends URIS2, G extends URIS2>(W: Comonad2<F>, M: Monad2<G>, T: Distributes22<F, G>) {
  return <E, A, B, C>(
    fa: BiKleisliIO<F, G, E, A, B>,
    f: (b: B) => BiKleisliIO<F, G, E, A, C>,
  ): BiKleisliIO<F, G, E, A, C> => pure(W, M, T)<E, A, C>((a) => M.chain(fa.run(a), (b) => f(b).run(a)));
}

/**
 * Create a new `BiKleisliIO` computation which result in `b`.
 * @param b Lazy value of type `B`
 */
export function point<F extends URIS2, G extends URIS2>(W: Comonad2<F>, M: Monad2<G>, T: Distributes22<F, G>) {
  return <E, A, B>(b: () => B): BiKleisliIO<F, G, E, A, B> => liftK(W, M, T)(b);
}

/**
 * Applicative `of` function.
 * Lift a value of type `B` into a context of `BiKleisliIO`.
 * @param b Value of type `B`
 */
export function of<F extends URIS2, G extends URIS2>(W: Comonad2<F>, M: Monad2<G>, T: Distributes22<F, G>) {
  return <E, A, B>(b: B): BiKleisliIO<F, G, E, A, B> => liftK(W, M, T)(() => b);
}

/**
 * Tuple swap, lifted in `BiKleisliIO` context.
 */
export function swap<F extends URIS2, G extends URIS2>(W: Comonad2<F>, M: Monad2<G>, T: Distributes22<F, G>) {
  return <E, A, B>(): BiKleisliIO<F, G, E, [A, B], [B, A]> => liftK(W, M, T)(([a, b]) => [b, a]);
}

/**
 * Perform right-to-left Kleisli arrows compotions.
 * @param second Second computation to apply
 * @param first First computation to apply
 */
export function composeK<F extends URIS2, G extends URIS2>(W: Comonad2<F>, M: Monad2<G>, T: Distributes22<F, G>) {
  return <E, A, B, C>(
    second: BiKleisliIO<F, G, E, B, C>,
    first: BiKleisliIO<F, G, E, A, B>,
  ): BiKleisliIO<F, G, E, A, C> =>
    isImpure(second) && isImpure(first) ?
      new Impure(W, M, T, flow(first._run, second._run)) :
      new Compose(W, M, T, first, second);
}

/**
 * Perform left-to-right Kleisli arrows compotions.
 * @param first First computation to apply
 * @param second Second computation to apply
 */
export function pipeK<F extends URIS2, G extends URIS2>(W: Comonad2<F>, M: Monad2<G>, T: Distributes22<F, G>) {
  return <E, A, B, C>(
    first: BiKleisliIO<F, G, E, A, B>,
    second: BiKleisliIO<F, G, E, B, C>,
  ): BiKleisliIO<F, G, E, A, C> =>
    composeK(W, M, T)(second, first);
}

/**
 * Depending on the input of type `Either<A, C>`, execute either `l` or `r` branches.
 * @param l Left branch of computation
 * @param r Right branch of computation
 */
export function switchK<F extends URIS2, G extends URIS2>(W: Comonad2<F>, M: Monad2<G>, T: Distributes22<F, G>) {
  return <E, A, B, C>(
    l: BiKleisliIO<F, G, E, A, B>,
    r: BiKleisliIO<F, G, E, C, B>,
  ): BiKleisliIO<F, G, E, Either<A, C>, B> =>
    isImpure(l) && isImpure(r) ?
      new Impure<F, G, E, Either<A, C>, B>(W, M, T, (ac) => pipe(
        ac,
        fold(
          (a) => l._run(a),
          (c) => r._run(c),
        )),
      ) :
      pure(W, M, T)(
        (fac) => pipe(
          fac,
          W.extract,
          fold(
            (a) => l.run(W.extend(fac, () => a)),
            (c) => r.run(W.extend(fac, () => c)),
          ),
        ),
      );
}

/**
 * Execute `l` and `r` computations and if both succeed, process the results with `f`.
 * @param l First `BiKleisliIO` computation
 * @param r Second `BiKleisliIO` computation
 * @param f Function to process the results of both computations
 */
export function zipWith<F extends URIS2, G extends URIS2>(W: Comonad2<F>, M: Monad2<G>, T: Distributes22<F, G>) {
  return <E, A, B, C, D>(l: BiKleisliIO<F, G, E, A, B>, r: BiKleisliIO<F, G, E, A, C>) =>
    (f: (t: [B, C]) => D): BiKleisliIO<F, G, E, A, D> =>
      isImpure(l) && isImpure(r) ?
        new Impure<F, G, E, A, D>(W, M, T, (a) => f([l._run(a), r._run(a)])) :
        pure(W, M, T)((a) => M.chain(l.run(a), (b) => M.map(r.run(a), (c) => f([b, c]))));
}

/**
 * Propagate the input unchanged.
 */
export function identity<F extends URIS2, G extends URIS2>(W: Comonad2<F>, M: Monad2<G>, T: Distributes22<F, G>) {
  return <E, A>(): BiKleisliIO<F, G, E, A, A> => liftK(W, M, T)((x) => x);
}

/**
 * Execute either the `k` computation or propagate the value of type `C` through, depending on an input.
 * A flipped version of @see right.
 * @param k Computation from `A` to `B`
 */
export function left<F extends URIS2, G extends URIS2>(W: Comonad2<F>, M: Monad2<G>, T: Distributes22<F, G>) {
  return <E, A, B, C>(k: BiKleisliIO<F, G, E, A, B>): BiKleisliIO<F, G, E, Either<A, C>, Either<B, C>> =>
    isImpure(k) ?
      new Impure(W, M, T, (ac) => pipe(ac, fold(
        (a) => eitherLeft(k._run(a)),
        (c) => eitherRight(c),
      ))) :
      pure(W, M, T)((fac) => pipe(
        fac,
        W.extract,
        fold(
          (a) => M.map(k.run(W.extend(fac, () => a)), (x) => eitherLeft(x)),
          (c) => M.of(eitherRight(c)),
        ),
      ));
}

/**
 * Execute either the `k` computation or propagate the value of type `C` through, depending on an input.
 * A flipped version of @see left.
 * @param k Computation from `A` to `B`
 */
export function right<F extends URIS2, G extends URIS2>(W: Comonad2<F>, M: Monad2<G>, T: Distributes22<F, G>) {
  return <E, A, B, C>(k: BiKleisliIO<F, G, E, A, B>): BiKleisliIO<F, G, E, Either<C, A>, Either<C, B>> =>
    isImpure(k) ?
      new Impure(W, M, T, (a) => pipe(a, fold(
        (l) => eitherLeft(l),
        (r) => eitherRight(k._run(r)),
      ))) :
      pure(W, M, T)((fca) => pipe(
        fca,
        W.extract,
        fold(
          (a) => M.of(eitherLeft(a)),
          (c) => M.map(k.run(W.extend(fca, () => c)), (x) => eitherRight(x)),
        ),
      ));
}

/**
 * Depending on the condition, propagate the original input through the left or right part of `Either`.
 * @param cond Predicate for `A`
 */
export function test<F extends URIS2, G extends URIS2>(W: Comonad2<F>, M: Monad2<G>, T: Distributes22<F, G>) {
  return <E, A>(cond: BiKleisliIO<F, G, E, A, boolean>): BiKleisliIO<F, G, E, A, Either<A, A>> =>
    cond.both(identity(W, M, T)()).andThen(liftK(W, M, T)(([c, a]) => c ? eitherLeft(a) : eitherRight(a)));
}

/**
 * Depending on the condition, execute either `then` or `else`.
 * @param cond Predicate for `A`
 * @param then Computation to run if `cond` is `true`
 * @param else_ Computation to run if `cond` is `false`
 */
export function ifThenElse<F extends URIS2, G extends URIS2>(W: Comonad2<F>, M: Monad2<G>, T: Distributes22<F, G>) {
  return <E, A, B>(cond: BiKleisliIO<F, G, E, A, boolean>) =>
    (then: BiKleisliIO<F, G, E, A, B>) => (else_: BiKleisliIO<F, G, E, A, B>): BiKleisliIO<F, G, E, A, B> =>
      isImpure(cond) && isImpure(then) && isImpure(else_) ?
        new Impure(W, M, T, (a) => cond._run(a) ? then._run(a) : else_._run(a)) :
        test(W, M, T)(cond).andThen(switchK(W, M, T)(then, else_));
}

/**
 * Simplified version of @see ifThenElse without the `else` part.
 * @param cond Predicate for `A`
 * @param then Computation to run if `cond` is `true`
 */
export function ifThen<F extends URIS2, G extends URIS2>(W: Comonad2<F>, M: Monad2<G>, T: Distributes22<F, G>) {
  return <E, A>(cond: BiKleisliIO<F, G, E, A, boolean>) =>
    (then: BiKleisliIO<F, G, E, A, A>): BiKleisliIO<F, G, E, A, A> =>
      ifThenElse(W, M, T)<E, A, A>(cond)(then)(identity(W, M, T)());
}

/**
 * While-loop: run `body` until `cond` is `true`.
 * @param cond Predicate for `A`
 * @param body Computation to run continuously until `cond` is `false`
 */
export function whileDo<F extends URIS2, G extends URIS2>(W: Comonad2<F>, M: Monad2<G>, T: Distributes22<F, G>) {
  return <E, A>(cond: BiKleisliIO<F, G, E, A, boolean>) =>
    (body: BiKleisliIO<F, G, E, A, A>): BiKleisliIO<F, G, E, A, A> => {
      if (isImpure(cond) && isImpure(body)) {
        return new Impure<F, G, E, A, A>(
          W,
          M,
          T,
          (a0) => {
            let a = a0;

            while (cond._run(a)) {
              a = body._run(a);
            }

            return a;
          },
        );
      } else {
        const loop = (): BiKleisliIO<F, G, E, A, A> =>
          pure(W, M, T)<E, A, A>((fa) => M.chain(cond.run(fa), (b) => b ? body.run(fa) : M.of(W.extract(fa))));

        return loop();
      }
    };
}

/**
 * Lifted version of `fst` tuple function.
 */
export function fst<F extends URIS2, G extends URIS2>(W: Comonad2<F>, M: Monad2<G>, T: Distributes22<F, G>) {
  return <E, A, B>(): BiKleisliIO<F, G, E, [A, B], A> => liftK(W, M, T)(([a]) => a);
}

/**
 * Lifted version of `snd` tuple function.
 */
export function snd<F extends URIS2, G extends URIS2>(W: Comonad2<F>, M: Monad2<G>, T: Distributes22<F, G>) {
  return <E, A, B>(): BiKleisliIO<F, G, E, [A, B], B> => liftK(W, M, T)(([, b]) => b);
}

/**
 * Convenience method which retruns instances of Kleisli API for the given monad.
 * @param M Monad2 & Bifunctor instance
 */
export function getInstancesFor<F extends URIS2, G extends URIS2>(
  W: Comonad2<F>,
  M: Monad2<G>,
  T: Distributes22<F, G>,
) {
  return ({
    /**
     * Applicative `of` function.
     * Lift a value of type `B` into a context of `BiKleisliIO`.
     * @param b Value of type `B`
     */
    of: of(W, M, T),
    /**
     * Create a new instance of `Pure` computation.
     * @param f Function to run
     */
    pure: pure(W, M, T),
    /**
     * Create a new instance of `Impure` computation.
     * @param catcher Function to transform the error from `Error` into `E`
     * @param f Impure computation from `A` to `B` which may throw
     */
    impure: impure(W, M, T),
    /**
     * Create a new `BiKleisliIO` computation from impure function which *you know* to never throw exceptions,
     * or throw exceptions which should lead to termination fo the program.
     * @param f Impure computation from `A` to `B`
     */
    impureVoid: impureVoid(W, M, T),
    /**
     * Lift the impure computation into `BiKleisliIO` context.
     * @param f Impure function from `A` to `B`
     */
    liftK: liftK(W, M, T),
    /**
     * Monadic `chain` function.
     * Apply function `f` to the result of current `BiKleisliIO<F, G, E, A, B>`,
     * determining the next flow of computations.
     * @param fa Basic Kleisli computation
     * @param f Function from `B` to `BiKleisliIO<F, G, E, A, C>`, which represents next sequential computation
     */
    chain: chain(W, M, T),
    /**
     * Create a new `BiKleisliIO` computation which result in `b`.
     * @param b Lazy value of type `B`
     */
    point: point(W, M, T),
    /**
     * Tuple swap, lifted in `BiKleisliIO` context.
     */
    swap: swap(W, M, T),
    /**
     * Perform right-to-left Kleisli arrows compotions.
     * @param second Second computation to apply
     * @param first First computation to apply
     */
    composeK: composeK(W, M, T),
    /**
     * Perform left-to-right Kleisli arrows compotions.
     * @param first First computation to apply
     * @param second Second computation to apply
     */
    pipeK: pipeK(W, M, T),
    /**
     * Depending on the input of type `Either<A, C>`, execute either `l` or `r` branches.
     * @param l Left branch of computation
     * @param r Right branch of computation
     */
    switchK: switchK(W, M, T),
    /**
     * Execute `l` and `r` computations and if both succeed, process the results with `f`.
     * @param l First `BiKleisliIO` computation
     * @param r Second `BiKleisliIO` computation
     * @param f Function to process the results of both computations
     */
    zipWith: zipWith(W, M, T),
    /**
     * Propagate the input unchanged.
     */
    identity: identity(W, M, T),
    /**
     * Execute either the `k` computation or propagate the value of type `C` through, depending on an input.
     * A flipped version of @see right.
     * @param k Computation from `A` to `B`
     */
    left: left(W, M, T),
    /**
     * Execute either the `k` computation or propagate the value of type `C` through, depending on an input.
     * A flipped version of @see left.
     * @param k Computation from `A` to `B`
     */
    right: right(W, M, T),
    /**
     * Depending on the condition, propagate the original input through the left or right part of `Either`.
     * @param cond Predicate for `A`
     */
    test: test(W, M, T),
    /**
     * Depending on the condition, execute either `then` or `else`.
     * @param cond Predicate for `A`
     * @param then Computation to run if `cond` is `true`
     * @param else_ Computation to run if `cond` is `false`
     */
    ifThenElse: ifThenElse(W, M, T),
    /**
     * Simplified version of @see ifThenElse without the `else` part.
     * @param cond Predicate for `A`
     * @param then Computation to run if `cond` is `true`
     */
    ifThen: ifThen(W, M, T),
    /**
     * While-loop: run `body` until `cond` is `true`.
     * @param cond Predicate for `A`
     * @param body Computation to run continuously until `cond` is `false`
     */
    whileDo: whileDo(W, M, T),
    /**
     * Lifted version of `fst` tuple function.
     */
    fst: fst(W, M, T),
    /**
     * Lifted version of `snd` tuple function.
     */
    snd: snd(W, M, T),
  });
}

export default getInstancesFor;
