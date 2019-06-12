// tslint:disable:max-line-length
/*
 * TypeScript port of John A. De Goes's talk about KleisliIO at LambdaConf'18:
 * https://www.youtube.com/watch?v=L8AEj6IRNEE
 * with additional instances of Applicative, Bifunctor, etc.
 * Original implementation in Scala can be found in this commit:
 * https://github.com/zio/zio/blob/c5c3f47c163c7638886205fefbadf43f7553751e/shared/src/main/scala/scalaz/effect/KleisliIO.scala
 */
// tslint:enable:max-line-length

import { Either, left as eitherLeft, right as eitherRight } from 'fp-ts/lib/Either';
import { compose } from 'fp-ts/lib/function';
import { IOEither, ioEither, tryCatch2v } from 'fp-ts/lib/IOEither';

/**
 * KleisliIO – an effectful function from `A` to `IOEither<E, B>`.
 * For more intuition about Kleisli arrows please @see http://www.cse.chalmers.se/~rjmh/Papers/arrows.pdf
 *
 * @template A domain type
 * @template E error type of codomain
 * @template B value type of codomain
 */
export abstract class KleisliIO<E, A, B> {
  abstract tag: 'Pure' | 'Impure' | 'Compose';

  /**
   * Executes current `KleisliIO`, yielding IO of either ann error of type `E` or value of type `B`.
   * @param a Value of type `A`
   */
  abstract run(a: A): IOEither<E, B>;

  /**
   * Applicative `of` function.
   * Lift a value of type `B` into a context of `KleisliIO`.
   * @param b Lazy value of type `B`
   */
  of(b: () => B): KleisliIO<E, A, B> {
    return point(b);
  }

  /**
   * Applicative `ap` function.
   * Apply a lifted in `KleisliIO` context function to current value of `KleisliIO`.
   * @param fbc Function from `B` to `C`, lifted in the context of `KleisliIO`
   */
  ap<C>(fbc: KleisliIO<E, A, (b: B) => C>): KleisliIO<E, A, C> {
    return pure((a) => this.run(a).ap(fbc.run(a)));
  }

  /**
   * Functorial `map` function.
   * Lift the passed function `f` into a context of `KleisliIO`.
   * @param f Function from `B` to `C` to transform the encapsulated value
   */
  map<C>(f: (b: B) => C): KleisliIO<E, A, C> {
    return this.andThen(liftK(f));
  }

  /**
   * Monadic `chain` function.
   * Apply function `f` to the result of current `KleisliIO<E, A, B>`, determining the next flow of computations.
   * @param f Function from `B` to `KleisliIO<E, A, C>`, which represents next sequential computation.
   */
  chain<C>(f: (b: B) => KleisliIO<E, A, C>) {
    return pure<E, A, C>((a) => this.run(a).chain((b) => f(b).run(a)));
  }

  /**
   * Bifunctorial `bimap` function.
   * Take two functions to transform both error and value parts simultaneously.
   * @param f Function to transform the error part
   * @param g Function to transform the value part
   */
  bimap<E1, C>(f: (e: E) => E1, g: (b: B) => C): KleisliIO<E1, A, C> {
    return pure((a) => this.run(a).bimap(f, g));
  }

  /**
   * Compose current `KleisliIO` with the next one.
   * @param that Sequential `KleisliIO` computation
   */
  andThen<C>(that: KleisliIO<E, B, C>): KleisliIO<E, A, C> {
    return composeK(that, this);
  }

  /**
   * Execute `this` and `that` computations and if both succeed, process the results with `f`.
   * @see both
   * @param that Second `KleisliIO` computation to run alongside with current
   * @param f Function to process the results of both computations
   */
  zipWith<C, D>(that: KleisliIO<E, A, C>): (f: (t: [B, C]) => D) => KleisliIO<E, A, D> {
    return (f) => zipWith<E, A, B, C, D>(this, that)(f);
  }

  /**
   * Execute `this` and `that` computations and return a tuple of results.
   * @see zipWith
   * @param that Second `KleisliIO` computation to run alongside with current
   */
  both<C>(that: KleisliIO<E, A, C>): KleisliIO<E, A, [B, C]> {
    return zipWith<E, A, B, C, [B, C]>(this, that)((x) => x);
  }

  /**
   * Depending on an input, run ether `this` or `that` computation.
   * @param that Alternative computation
   */
  join<C>(that: KleisliIO<E, C, B>): KleisliIO<E, Either<A, C>, B> {
    return switchK(this, that);
  }

  /**
   * Pass the original imput of type `A` alongside with the result of computation of type `B`, which comes *first*.
   */
  first(): KleisliIO<E, A, [B, A]> {
    return this.both(identity<E, A>());
  }

  /**
   * Pass the original imput of type `A` alongside with the result of computation of type `B`, which comes *second*.
   */
  second(): KleisliIO<E, A, [A, B]> {
    return identity<E, A>().both(this);
  }

  /**
   * Discard the results of `this` computation and return `c`.
   * @param c Value of type `C` to return
   */
  constant<C>(c: C): KleisliIO<E, A, C> {
    return this.andThen(liftK(() => c));
  }

  /**
   * Discard the results of `this` computation.
   */
  toVoid(): KleisliIO<E, A, void> {
    return this.constant(void 0);
  }

  /**
   * Discard the results of `this` computation and propagate the original input.
   * Effectively just keep the effect of `this` computation.
   */
  asEffect(): KleisliIO<E, A, A> {
    return this.first().andThen(snd());
  }
}

/**
 * Specialized error type for KleisliIO
 */
class KleisliIOError<E> extends Error {
  constructor(readonly error: E) { super(String(error)); }
}

/**
 * A pure functional computation from `A` to `IOEither<E, B>`, which **never** throws in runtime.
 *
 * @see KleisliIO
 *
 * @template A domain type
 * @template E error type of codomain
 * @template B value type of codomain
 */
class Pure<E, A, B> extends KleisliIO<E, A, B> {
  readonly tag = 'Pure';
  constructor(readonly _run: (a: A) => IOEither<E, B>) { super(); }

  run = (a: A): IOEither<E, B> => this._run(a);
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
class Impure<E, A, B> extends KleisliIO<E, A, B> {
  readonly tag = 'Impure';
  constructor(readonly _run: (a: A) => B) { super(); }

  run = (a: A): IOEither<E, B> => tryCatch2v(() => this._run(a), (e) => {
    if (e instanceof KleisliIOError) {
      return e.error;
    }
    return e as E;
  })
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
class Compose<E, A, B, C> extends KleisliIO<E, A, C> {
  readonly tag = 'Compose';
  constructor(readonly g: KleisliIO<E, B, C>, readonly f: KleisliIO<E, A, B>) { super(); }

  run = (a: A): IOEither<E, C> => this.f.run(a).chain(this.g.run);
}

const isImpure = <E, A, B>(a: KleisliIO<E, A, B>): a is Impure<E, A, B> => a.tag === 'Impure';

/**
 * Create a new instance of `Pure` computation.
 * @param f Function to run
 */
export const pure = <E, A, B>(f: (a: A) => IOEither<E, B>): KleisliIO<E, A, B> => new Pure<E, A, B>(f);

/**
 * Create a new instance of `Impure` computation.
 * @param catcher Function to transform the error from `Error` into `E`
 * @param f Impure computation from `A` to `B` which may throw
 */
export const impure = <E>(catcher: (e: Error) => E) => <A, B>(f: (a: A) => B): KleisliIO<E, A, B> => new Impure(
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
export const impureVoid = <A, B>(f: (a: A) => B): KleisliIO<never, A, B> => impure(voidCatcher)(f);

/**
 * Lift the impure computation into `KleisliIO` context.
 * @param f Impure function from `A` to `B`
 */
export const liftK = <E, A, B>(f: (a: A) => B): KleisliIO<E, A, B> => new Impure(f);

/**
 * Create a new `KleisliIO` computation which result in `b`.
 * @param b Lazy value of type `B`
 */
export const point = <E, A, B>(b: () => B): KleisliIO<E, A, B> => liftK(b);

/**
 * Fail with an error of type `E`.
 * @param e Error of type `E`
 */
export const fail = <E, A, B>(e: E): KleisliIO<E, A, B> => new Impure(() => { throw new KleisliIOError(e); });

/**
 * Tuple swap, lifted in `KleisliIO` context.
 */
export const swap = <E, A, B>(): KleisliIO<E, [A, B], [B, A]> => liftK(([a, b]) => [b, a]);

/**
 * Perform right-to-left Kleisli arrows compotions.
 * @param second Second computation to apply
 * @param first First computation to apply
 */
export const composeK = <E, A, B, C>(second: KleisliIO<E, B, C>, first: KleisliIO<E, A, B>): KleisliIO<E, A, C> =>
  isImpure(second) && isImpure(first) ?
    new Impure(compose(second._run, first._run)) :
    new Compose(second, first);

/**
 * Perform left-to-right Kleisli arrows compotions.
 * @param first First computation to apply
 * @param second Second computation to apply
 */
export const pipeK = <E, A, B, C>(first: KleisliIO<E, A, B>, second: KleisliIO<E, B, C>): KleisliIO<E, A, C> =>
  composeK(second, first);

/**
 * Depending on the input of type `Either<A, C>`, execute either `l` or `r` branches.
 * @param l Left branch of computation
 * @param r Right branch of computation
 */
export const switchK = <E, A, B, C>(l: KleisliIO<E, A, B>, r: KleisliIO<E, C, B>): KleisliIO<E, Either<A, C>, B> =>
  isImpure(l) && isImpure(r) ?
    new Impure<E, Either<A, C>, B>((a) => a.fold(
      (al) => l._run(al),
      (ar) => r._run(ar),
    )) :
    pure((a) => a.fold(
      (al) => l.run(al),
      (ar) => r.run(ar),
    ));

/**
 * Execute `l` and `r` computations and if both succeed, process the results with `f`.
 * @param l First `KleisliIO` computation
 * @param r Second `KleisliIO` computation
 * @param f Function to process the results of both computations
 */
export const zipWith = <E, A, B, C, D>(l: KleisliIO<E, A, B>, r: KleisliIO<E, A, C>) =>
  (f: (t: [B, C]) => D): KleisliIO<E, A, D> =>
    isImpure(l) && isImpure(r) ?
      new Impure<E, A, D>((a) => f([l._run(a), r._run(a)])) :
      pure((a) => l.run(a).chain((b) => r.run(a).map((c) => f([b, c]))));

/**
 * Propagate the input unchanged.
 */
export const identity = <E, A>(): KleisliIO<E, A, A> => liftK((x) => x);

/**
 * Execute either the `k` computation or propagate the value of type `C` through, depending on an input.
 * A flipped version of @see right.
 * @param k Computation from `A` to `B`
 */
export const left = <E, A, B, C>(k: KleisliIO<E, A, B>): KleisliIO<E, Either<A, C>, Either<B, C>> =>
  isImpure(k) ?
    new Impure((a) => a.fold(
      (l) => eitherLeft(k._run(l)),
      (r) => eitherRight(r),
    )) :
    pure((a) => a.fold(
      (l) => k.run(l).map<Either<B, C>>(eitherLeft),
      (r) => ioEither.of(eitherRight(r)),
    ));

/**
 * Execute either the `k` computation or propagate the value of type `C` through, depending on an input.
 * A flipped version of @see left.
 * @param k Computation from `A` to `B`
 */
export const right = <E, A, B, C>(k: KleisliIO<E, A, B>): KleisliIO<E, Either<C, A>, Either<C, B>> =>
  isImpure(k) ?
    new Impure((a) => a.fold(
      (l) => eitherLeft(l),
      (r) => eitherRight(k._run(r)),
    )) :
    pure((a) => a.fold(
      (l) => ioEither.of(eitherLeft(l)),
      (r) => k.run(r).map<Either<C, B>>(eitherRight),
    ));

/**
 * Depending on the condition, propagate the original input through the left or right part of `Either`.
 * @param cond Predicate for `A`
 */
export const test = <E, A>(cond: KleisliIO<E, A, boolean>): KleisliIO<E, A, Either<A, A>> =>
  cond.both(identity()).andThen(liftK(([c, a]) => c ? eitherLeft(a) : eitherRight(a)));

/**
 * Depending on the condition, execute either `then` or `else`.
 * @param cond Predicate for `A`
 * @param then Computation to run if `cond` is `true`
 * @param else_ Computation to run if `cond` is `false`
 */
export const ifThenElse = <E, A, B>(cond: KleisliIO<E, A, boolean>) =>
  (then: KleisliIO<E, A, B>) => (else_: KleisliIO<E, A, B>): KleisliIO<E, A, B> =>
    isImpure(cond) && isImpure(then) && isImpure(else_) ?
      new Impure((a) => cond._run(a) ? then._run(a) : else_._run(a)) :
      test(cond).andThen(switchK(then, else_));

/**
 * Simplified version of @see ifThenElse without the `else` part.
 * @param cond Predicate for `A`
 * @param then Computation to run if `cond` is `true`
 */
export const ifThen = <E, A>(cond: KleisliIO<E, A, boolean>) =>
  (then: KleisliIO<E, A, A>): KleisliIO<E, A, A> => ifThenElse<E, A, A>(cond)(then)(identity());

/**
 * While-loop: run `body` until `cond` is `true`.
 * @param cond Predicate for `A`
 * @param body Computation to run continuously until `cond` is `true`
 */
export const whileDo = <E, A>(cond: KleisliIO<E, A, boolean>) => (body: KleisliIO<E, A, A>): KleisliIO<E, A, A> => {
  if (isImpure(cond) && isImpure(body)) {
    return new Impure<E, A, A>(
      (a0) => {
        let a = a0;

        while (cond._run(a)) {
          a = body._run(a);
        }

        return a;
      },
    );
  } else {
    const loop = (): KleisliIO<E, A, A> =>
      pure<E, A, A>((a) => cond.run(a).chain((b) => b ? body.run(a).chain(loop().run) : ioEither.of(a)));

    return loop();
  }
};

/**
 * Lifted version of `fst` tuple function.
 */
export const fst = <E, A, B>(): KleisliIO<E, [A, B], A> => liftK(([a]) => a);

/**
 * Lifted version of `snd` tuple function.
 */
export const snd = <E, A, B>(): KleisliIO<E, [A, B], B> => liftK(([, b]) => b);

/**
 * Unfolds the `IOEither` structure and throws `E` as an exception, or returns `A` as a result.
 *
 * @example
 * const k: KleisliIO<Error, void, string> = liftK(() => {
 *  if (Math.random() > 0.5) {
 *    throw new Error('oops');
 *  }
 *  return 'foo';
 * });
 * const log: KleisliIO<never, string, void> = impureVoid((s) => console.log(s));
 *
 * unsafeRun(k.andThen(log).run()); // 🤞🏻 hope it doesn't blow up and prints 'foo'
 *
 * @param ie `IOEither` to run
 */
export const unsafeRun = <E, A>(ie: IOEither<E, A>): A => ie.run().fold((e) => { throw e; }, (a) => a);
