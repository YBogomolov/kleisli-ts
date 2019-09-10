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
// tslint:disable:no-unused-expression

import { expect } from 'chai';
import { either, fold, isLeft, isRight, left, Left, right, Right, URI } from 'fp-ts/lib/Either';
import { flow, identity } from 'fp-ts/lib/function';

import { getInstancesFor, KleisliIO } from './kleisli-io';

const K = getInstancesFor(either);

describe('BiKleisli suite', () => {
  describe('Functor laws', () => {
    it('should preserve identity', () => {
      // fmal id ≡ id
      const fa: KleisliIO<URI, string, boolean, string> = K.pure((a) => a ? right(String(a)) : left(String(a)));
      const fa1: KleisliIO<URI, string, boolean, string> = fa.map(identity);

      expect(fa.run(true)).to.deep.equal(fa1.run(true));
      expect(fa.run(false)).to.deep.equal(fa1.run(false));
    });

    it('should preserve composition of morphisms', () => {
      // fmap (f . g) ≡ fmap f . fmap g
      const fa: KleisliIO<URI, string, boolean, string> = K.pure((a) => a ? right(String(a)) : left(String(a)));

      const f = (a: string) => `${a}!`;
      const g = (a: string) => a.length;

      const f_o_g = flow(f, g);

      const fa1 = fa.map(f).map(g);
      const fa2 = fa.map(f_o_g);

      expect(fa1.run(true)).to.deep.equal(fa2.run(true));
      expect(fa1.run(false)).to.deep.equal(fa2.run(false));
    });
  });

  describe('Monad laws', () => {
    it('left identity', () => {
      // return a >>= f ≡ f a
      const f = (a: number) => K.of<never, void, string>(String(a));

      expect(K.of<never, void, number>(42).chain(f).run()).to.deep.equal(f(42).run());
    });

    it('right identity', () => {
      // m >>= return ≡ m
      const m = K.pure<never, void, number>(() => right(42));

      expect(m.chain(K.of).run()).to.deep.equal(m.run());
    });

    it('associativity', () => {
      // (m >>= f) >>= g ≡ m >>= (\x -> f x >>= g)
      const m = K.of<never, void, number>(42);
      const f = (a: number) => K.of<never, void, string>(String(a));
      const g = (s: string) => K.of<never, void, number>(s.length);

      expect(m.chain(f).chain(g).run()).to.deep.equal(m.chain((n) => f(n).chain(g)).run());
    });
  });

  describe('BiKleisli API', () => {
    it('of', () => {
      const m = K.of<never, void, number>(42);

      expect(isRight(m.run())).to.be.true;
      expect((m.run() as Right<number>).right).to.equal(42);
    });

    it('pure', () => {
      const m = K.pure<Error, string, string>(
        (s: string) => s.length > 0 ? right(s.toLocaleUpperCase() + '!') : left(new Error('empty string')),
      );

      expect(isRight(m.run('aaaa'))).to.be.true;
      expect((m.run('aaaa') as Right<string>).right).to.equal('AAAA!');
      expect(isLeft(m.run(''))).to.be.true;
      expect((m.run('') as Left<Error>).left)
        .to.be.an.instanceOf(Error)
        .and
        .to.have.property('message').equal('empty string');
    });

    it('impure', () => {
      const f = (s: string) => {
        if (s.length === 0) {
          throw new Error('empty string');
        }
        return s.toLocaleUpperCase() + '!';
      };
      const m = K.impure(identity)(f);

      expect(isRight(m.run('aaaa'))).to.be.true;
      expect((m.run('aaaa') as Right<string>).right).to.equal('AAAA!');
      expect(isLeft(m.run(''))).to.be.true;
      expect((m.run('') as Left<Error>).left)
        .to.be.an.instanceOf(Error)
        .and
        .to.have.property('message').equal('empty string');
    });

    it('impureVoid', () => {
      const f = (terminate: boolean) => {
        if (terminate) {
          throw new Error('terminate');
        }
        return true;
      };
      const m = K.impureVoid(f);

      try {
        expect((m.run(false) as Right<boolean>).right).to.be.true;
        m.run(true);
        expect.fail();
      } catch (e) {
        expect(e).to.be.an.instanceOf(Error);
        expect(e).to.have.property('message').equal('terminate');
      }
    });

    it('liftK', () => {
      const f = (s: string) => s.length;
      const m = K.liftK<never, string, number>(f);

      expect(isRight(m.run(''))).to.be.true;
      expect((m.run('') as Right<number>).right).to.equal(0);
      expect(isRight(m.run('aaaa'))).to.be.true;
      expect((m.run('aaaa') as Right<number>).right).to.equal(4);
    });

    it('chain', () => {
      const f = (s: string) => s.length > 0 ?
        K.of<Error, void, number>(s.length) :
        K.fail<Error, void, number>(new Error('empty string'));

      expect(isRight(K.of<Error, void, string>('aaa').chain(f).run())).to.be.true;
      expect(K.of<Error, void, string>('aaa').chain(f).run()).to.deep.equal(right(3));
      expect(isLeft(K.of<Error, void, string>('').chain(f).run())).to.be.true;
      expect((K.of<Error, void, string>('').chain(f).run() as Left<Error>).left)
        .to.be.an.instanceOf(Error)
        .and
        .to.have.property('message').equal('empty string');
    });

    it('point', () => {
      const m = K.point<never, void, number>(() => 42);

      expect(isRight(m.run())).to.be.true;
      expect(m.run()).to.deep.equal(right(42));
    });

    it('fail', () => {
      const m = K.fail(new Error('fail'));

      fold(
        (l) => expect(l).to.be.an.instanceOf(Error).and.to.have.property('message').equal('fail'),
        () => expect.fail('is right'),
      )(m.run({}));
    });

    it('swap', () => {
      expect(K.swap().run([1, true])).to.deep.equal(right([true, 1]));
    });

    it('composeK', () => {
      const f = K.pure<Error, string, string>(
        (s) => s.length > 0 ? right(s.toLocaleUpperCase() + '!') : left(new Error('empty string')),
      );
      const g = K.pure<Error, string, number>(
        (s) => s.length > 0 ? right(s.length) : left(new Error('empty string')),
      );

      fold(
        () => expect.fail('is left'),
        (r) => expect(r).to.equal(4),
      )(K.composeK(g, f).run('aaa'));
      fold(
        (l) => expect(l).to.be.an.instanceOf(Error).and.to.have.property('message').equal('empty string'),
        () => expect.fail('is right'),
      )(K.composeK(g, f).run(''));
    });

    it('pipeK', () => {
      const f = K.pure<Error, string, string>(
        (s) => s.length > 0 ? right(s.toLocaleUpperCase() + '!') : left(new Error('empty string')),
      );
      const g = K.pure<Error, string, number>(
        (s) => s.length > 0 ? right(s.length) : left(new Error('empty string')),
      );

      fold(
        () => expect.fail('is left'),
        (r) => expect(r).to.equal(4),
      )(K.pipeK(f, g).run('aaa'));
      fold(
        (l) => expect(l).to.be.an.instanceOf(Error).and.to.have.property('message').equal('empty string'),
        () => expect.fail('is right'),
      )(K.pipeK(f, g).run(''));
    });

    it('switchK', () => {
      const m = K.switchK<never, string, boolean, number>(
        K.liftK((s) => s.length > 0),
        K.liftK((n) => n > 0),
      );

      fold(
        () => expect.fail('is left'),
        (r) => expect(r).to.be.true,
      )(m.run(right(42)));
      fold(
        () => expect.fail('is left'),
        (r) => expect(r).to.be.false,
      )(m.run(left('')));
    });

    it('zipWith', () => {
      const m = K.zipWith<never, string, boolean, boolean, string>(
        K.liftK((s) => s.startsWith('a')),
        K.liftK((s) => s.endsWith('!')),
      )(([startsWithA, endsWithBang]) => {
        switch (true) {
          case startsWithA && endsWithBang:
            return 'String starts with "a" and ends with "!"';
          case startsWithA:
            return 'String starts with "a"';
          case endsWithBang:
            return 'String ends with "!"';
          default:
            return 'String neither starts with "a", nor ends with "!"';
        }
      });

      fold(
        () => expect.fail('is left'),
        (r) => expect(r).to.equal('String starts with "a"'),
      )(m.run('a'));
      fold(
        () => expect.fail('is left'),
        (r) => expect(r).to.equal('String starts with "a" and ends with "!"'),
      )(m.run('a!'));
      fold(
        () => expect.fail('is left'),
        (r) => expect(r).to.equal('String neither starts with "a", nor ends with "!"'),
      )(m.run('foo'));
      fold(
        () => expect.fail('is left'),
        (r) => expect(r).to.equal('String ends with "!"'),
      )(m.run('foo!'));
    });

    it('identity', () => {
      expect(isRight(K.identity().run(42))).to.be.true;
      expect(K.identity().run(42)).to.deep.equal(right(42));
    });

    it('left', () => {
      const m = K.left<never, number, string, number>(K.liftK((n) => n.toString()));
      expect(isRight(m.run(right(42)))).to.be.true;
      expect(m.run(right(42))).to.deep.equal(right(right(42)));
      expect(isRight(m.run(left(41)))).to.be.true;
      expect(m.run(left(41))).to.deep.equal(right(left('41')));
    });

    it('right', () => {
      const m = K.right<never, number, string, number>(K.liftK((n) => n.toString()));
      expect(isRight(m.run(right(42)))).to.be.true;
      expect(m.run(right(42))).to.deep.equal(right(right('42')));
      expect(isRight(m.run(left(41)))).to.be.true;
      expect(m.run(left(41))).to.deep.equal(right(left(41)));
    });

    it('test', () => {
      const m = K.test(K.liftK<never, number, boolean>((n) => n % 2 === 0));

      fold(
        () => expect.fail('is right'),
        (r) => expect(r).to.deep.equal(left(42)),
      )(m.run(42));
      fold(
        () => expect.fail('is left'),
        (r) => expect(r).to.deep.equal(right(41)),
      )(m.run(41));
    });

    it('ifThenElse', () => {
      const m = K.ifThenElse<never, number, string>
        (K.liftK((n) => n % 2 === 0))
        (K.liftK((n) => `is even: ${n}`))
        (K.liftK((n) => `is odd: ${n}`));

      expect(isRight(m.run(42))).to.be.true;
      expect(m.run(42)).to.deep.equal(right('is even: 42'));
      expect(isRight(m.run(41))).to.be.true;
      expect(m.run(41)).to.deep.equal(right('is odd: 41'));
    });

    it('ifThen', () => {
      const m = K.ifThen<never, number>
        (K.liftK((n) => n % 2 === 1))
        (K.liftK((n) => n + 1));

      expect(isRight(m.run(41))).to.be.true;
      expect(m.run(41)).to.deep.equal(right(42));
      expect(isRight(m.run(42))).to.be.true;
      expect(m.run(42)).to.deep.equal(right(42));
    });

    it('whileDo', () => {
      let callCount = 0;
      const m = K.whileDo<never, number>
        (K.liftK((n) => n < 10))
        (K.liftK((n) => {
          callCount++;
          return n + 1;
        }));

      const res = m.run(4);

      expect(isRight(res)).to.be.true;
      expect(res).to.deep.equal(right(10));
      expect(callCount).to.equal(6);
    });

    it('fst', () => {
      expect(isRight(K.fst().run([1, true]))).to.be.true;
      expect(K.fst().run([1, true])).to.deep.equal(right(1));
    });

    it('snd', () => {
      expect(isRight(K.snd().run([1, true]))).to.be.true;
      expect(K.snd().run([1, true])).to.deep.equal(right(true));
    });
  });
});
