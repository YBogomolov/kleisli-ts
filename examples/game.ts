import { Task } from 'fp-ts/lib/Task';
import { taskEither, TaskEither, URI } from 'fp-ts/lib/TaskEither';
import { createInterface } from 'readline';

import { identity, impureVoid, KleisliIO, liftK, point, pure, whileDo } from '../src';
import { unsafeRunTE } from '../src/unsafe';

const read: KleisliIO<URI, Error, void, string> =
  pure(taskEither)(
    () => taskEither.fromTask(new Task(() => new Promise<string>((resolve) => {
      const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      rl.question('> ', (answer) => {
        rl.close();
        resolve(answer);
      });
    }))),
  );

const log: KleisliIO<URI, never, string, void> =
  impureVoid(taskEither)((message: string) => console.log(message));

const random: KleisliIO<URI, never, number, number> =
  impureVoid(taskEither)((next: number) => Math.floor(Math.random() * next + 1));

const parse: KleisliIO<URI, Error, string, number> =
  pure(taskEither)((s: string): TaskEither<Error, number> => {
    const i = +s;
    return (isNaN(i) || i % 1 !== 0) ? taskEither.throwError(new Error(`${s} is not a number`)) : taskEither.of(i);
  });

const isYes: KleisliIO<URI, Error, string, boolean> =
  liftK(taskEither)((answer) => answer === 'y');

const readAnswer: KleisliIO<URI, Error, string, string> =
  liftK(taskEither)<Error, string, string>((name: string) => `Do you want to continue, ${name}?`)
    .andThen(log)
    .andThen(read);

const check: KleisliIO<URI, Error, string, boolean> =
  readAnswer
    .andThen(
      whileDo(taskEither)<Error, string>(liftK(taskEither)((answer) => answer !== 'y' && answer !== 'n'))(readAnswer),
    )
    .andThen(isYes);

const round: KleisliIO<URI, Error, string, void> =
  liftK(taskEither)<Error, string, string>((name: string) => `${name}, guess a number between 1 and 5`)
    .andThen(log)
    .andThen(read)
    .andThen(parse)
    .andThen(
      point(taskEither)<Error, number, number>(() => 5)
        .andThen(random)
        .second(),
    )
    .andThen(liftK(taskEither)(
      ([guess, secret]) => guess !== secret ?
        `You guessed wrong. The number was: ${secret}` :
        `You guessed right!`,
    ))
    .andThen(log);

const gameloop: KleisliIO<URI, Error, string, void> =
  identity(taskEither)<Error, string>()
    .andThen(round.asEffect().andThen(check))
    .chain((answer) => answer ? gameloop : point(taskEither)(() => void 0));

const game: KleisliIO<URI, Error, void, void> =
  point(taskEither)<Error, void, string>(() => `What's your name?`)
    .andThen(log)
    .andThen(read)
    .andThen(gameloop);

unsafeRunTE(game.run());
