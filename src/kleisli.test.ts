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
import { fold, left, right } from 'fp-ts/lib/Either';
import { flow, identity as id } from 'fp-ts/lib/function';
import { identity, URI } from 'fp-ts/lib/Identity';

import { getInstancesFor, Kleisli } from './kleisli';

const K = getInstancesFor(identity);

describe('Kleisli suite', () => {
  describe('Functor laws', () => {
    it('should preserve identity', () => {
      // fmal id ≡ id
      const fa: Kleisli<URI, boolean, string> = K.pure((a) => identity.of(String(a)));
      const fa1: Kleisli<URI, boolean, string> = fa.map(id);

      expect(fa.run(true)).to.deep.equal(fa1.run(true));
      expect(fa.run(false)).to.deep.equal(fa1.run(false));
    });

    it('should preserve composition of morphisms', () => {
      // fmap (f . g) ≡ fmap f . fmap g
      const fa: Kleisli<URI, boolean, string> = K.pure((a) => identity.of(String(a)));

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
      const f = (a: number) => K.of<void, string>(String(a));

      expect(K.of<void, number>(42).chain(f).run()).to.deep.equal(f(42).run());
    });

    it('right identity', () => {
      // m >>= return ≡ m
      const m = K.pure<void, number>(() => identity.of(42));

      expect(m.chain(K.of).run()).to.deep.equal(m.run());
    });

    it('associativity', () => {
      // (m >>= f) >>= g ≡ m >>= (\x -> f x >>= g)
      const m = K.of<void, number>(42);
      const f = (a: number) => K.of<void, string>(String(a));
      const g = (s: string) => K.of<void, number>(s.length);

      expect(m.chain(f).chain(g).run()).to.deep.equal(m.chain((n) => f(n).chain(g)).run());
    });
  });

  describe('Kleisli API', () => {
    it('of', () => {
      const m = K.of<void, number>(42);

      expect(m.run()).to.equal(42);
    });

    it('pure', () => {
      const m = K.pure<string, string>(
        (s: string) => identity.of(s.toLocaleUpperCase() + '!'),
      );

      expect(m.run('aaaa')).to.equal('AAAA!');
    });

    it('impure', () => {
      const f = (s: string) => {
        if (s.length === 0) {
          throw new Error('empty string');
        }
        return s.toLocaleUpperCase() + '!';
      };
      const m = K.impure(id)(f);

      expect(m.run('aaaa')).to.equal('AAAA!');
      expect(() => m.run('')).throws('empty string');
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
        expect(m.run(false)).to.be.true;
        m.run(true);
        expect.fail();
      } catch (e) {
        expect(e).to.be.an.instanceOf(Error).and.to.have.property('message').equal('terminate');
      }
    });

    it('liftK', () => {
      const f = (s: string) => s.length;
      const m = K.liftK<string, number>(f);

      expect(m.run('')).to.equal(0);
      expect(m.run('aaaa')).to.equal(4);
    });

    it('chain', () => {
      const f = (s: string) => K.of<void, number>(s.length);

      expect(K.of<void, string>('aaa').chain(f).run()).to.equal(3);
    });

    it('point', () => {
      const m = K.point<void, number>(() => 42);

      expect(m.run()).to.equal(42);
    });

    it('swap', () => {
      expect(K.swap().run([1, true])).to.deep.equal([true, 1]);
    });

    it('flowK', () => {
      const f = K.pure<string, string>((s) => identity.of(s.toLocaleUpperCase() + '!'));
      const g = K.pure<string, number>((s) => identity.of(s.length));

      expect(K.composeK(g, f).run('aaa')).to.equal(4);
    });

    it('pipeK', () => {
      const f = K.pure<string, string>((s) => identity.of(s.toLocaleUpperCase() + '!'));
      const g = K.pure<string, number>((s) => identity.of(s.length));

      expect(K.pipeK(f, g).run('aaa')).to.equal(4);
    });

    it('switchK', () => {
      const m = K.switchK<string, boolean, number>(
        K.liftK((s) => s.length > 0),
        K.liftK((n) => n > 0),
      );

      expect(m.run(right(42))).to.be.true;
      expect(m.run(left(''))).to.be.false;
    });

    it('zipWith', () => {
      const m = K.zipWith<string, boolean, boolean, string>(
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

      expect(m.run('a')).to.equal('String starts with "a"');
      expect(m.run('a!')).to.equal('String starts with "a" and ends with "!"');
      expect(m.run('foo')).to.equal('String neither starts with "a", nor ends with "!"');
      expect(m.run('foo!')).to.equal('String ends with "!"');
    });

    it('identity', () => {
      expect(K.identity().run(42)).to.equal(42);
    });

    it('left', () => {
      const m = K.left<number, string, number>(K.liftK((n) => n.toString()));
      expect(m.run(right(42))).to.deep.equal(right(42));
      expect(m.run(left(41))).to.deep.equal(left('41'));
    });

    it('right', () => {
      const m = K.right<number, string, number>(K.liftK((n) => n.toString()));
      expect(m.run(right(42))).to.deep.equal(right('42'));
      expect(m.run(left(41))).to.deep.equal(left(41));
    });

    it('test', () => {
      const m = K.test(K.liftK<number, boolean>((n) => n % 2 === 0));

      fold(
        (l) => expect(l).to.equal(42),
        () => expect.fail('is right'),
      )(m.run(42));
      fold(
        () => expect.fail('is left'),
        (r) => expect(r).to.equal(41),
      )(m.run(41));
    });

    it('ifThenElse', () => {
      const m = K.ifThenElse<number, string>
        (K.liftK((n) => n % 2 === 0))
        (K.liftK((n) => `is even: ${n}`))
        (K.liftK((n) => `is odd: ${n}`));

      expect(m.run(42)).to.equal('is even: 42');
      expect(m.run(41)).to.equal('is odd: 41');
    });

    it('ifThen', () => {
      const m = K.ifThen<number>
        (K.liftK((n) => n % 2 === 1))
        (K.liftK((n) => n + 1));

      expect(m.run(41)).to.equal(42);
      expect(m.run(42)).to.equal(42);
    });

    it('whileDo', () => {
      let callCount = 0;
      const m = K.whileDo<number>
        (K.liftK((n) => n < 10))
        (K.liftK((n) => {
          callCount++;
          return n + 1;
        }));

      const res = m.run(4);

      expect(res).to.equal(10);
      expect(callCount).to.equal(6);
    });

    it('fst', () => {
      expect(K.fst().run([1, true])).to.equal(1);
    });

    it('snd', () => {
      expect(K.snd().run([1, true])).to.be.true;
    });
  });
});
