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
 */

import { fold } from 'fp-ts/lib/Either';
import { identity } from 'fp-ts/lib/function';
import { IOEither } from 'fp-ts/lib/IOEither';
import { pipe } from 'fp-ts/lib/pipeable';
import { TaskEither } from 'fp-ts/lib/TaskEither';

/**
 * Unfolds the `TaskEither` structure and throws `E` as an exception, or returns `A` as a result.
 *
 * @example
 * const k: KleisliIO<TaskEitherURI, Error, void, string> = liftK(M)(() => {
 *  if (Math.random() > 0.5) {
 *    throw new Error('oops');
 *  }
 *  return 'foo';
 * });
 * const log: KleisliIO<TaskEitherURI, never, string, void> = impureVoid((s) => console.log(s));
 *
 * unsafeRunTE(k.andThen(log).run()); // 🤞🏻 hope it doesn't blow up and prints 'foo'
 *
 * @param ie `TaskEither` to run
 */
export const unsafeRunTE = async <E, A>(ie: TaskEither<E, A>): Promise<A> => pipe(
  (await ie.run()),
  fold((e) => { throw e; }, identity),
);

/**
 * Unfolds the `IOEither` structure and throws `E` as an exception, or returns `A` as a result.
 *
 * @example
 * const k: KleisliIO<IOEitherURI, Error, void, string> = liftK(M)(() => {
 *  if (Math.random() > 0.5) {
 *    throw new Error('oops');
 *  }
 *  return 'foo';
 * });
 * const log: KleisliIO<IOEitherURI, never, string, void> = impureVoid((s) => console.log(s));
 *
 * unsafeRunIE(k.andThen(log).run()); // 🤞🏻 hope it doesn't blow up and prints 'foo'
 *
 * @param ie `IOEither` to run
 */
export const unsafeRunIE = <E, A>(ie: IOEither<E, A>): A => pipe(
  ie.run(),
  fold((e) => { throw e; }, identity),
);
