// tslint:disable:no-unused-expression

import { expect } from 'chai';
import { either, left, right, URI } from 'fp-ts/lib/Either';
import { compose, identity } from 'fp-ts/lib/function';

import { getInstancesFor, KleisliIO } from '.';

const K = getInstancesFor(either);

describe('KleisliIO suite', () => {
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

      const f_o_g = compose(g, f);

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

  describe('KleisliIO API', () => {
    it('of', () => {
      const m = K.of<never, void, number>(42);

      expect(m.run().isRight()).to.be.true;
      expect(m.run().value).to.equal(42);
    });

    it('pure', () => {
      const m = K.pure<Error, string, string>(
        (s: string) => s.length > 0 ? right(s.toLocaleUpperCase() + '!') : left(new Error('empty string')),
      );

      expect(m.run('aaaa').isRight()).to.be.true;
      expect(m.run('aaaa').value).to.equal('AAAA!');
      expect(m.run('').isLeft()).to.be.true;
      expect(m.run('').value).to.be.an.instanceOf(Error);
      expect(m.run('').value as Error).to.have.property('message').equal('empty string');
    });

    it('impure', () => {
      const f = (s: string) => {
        if (s.length === 0) {
          throw new Error('empty string');
        }
        return s.toLocaleUpperCase() + '!';
      };
      const m = K.impure(identity)(f);

      expect(m.run('aaaa').isRight()).to.be.true;
      expect(m.run('aaaa').value).to.equal('AAAA!');
      expect(m.run('').isLeft()).to.be.true;
      expect(m.run('').value).to.be.an.instanceOf(Error);
      expect(m.run('').value as Error).to.have.property('message').equal('empty string');
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
        expect(m.run(false).value).to.be.true;
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

      expect(m.run('').isRight()).to.be.true;
      expect(m.run('').value).to.equal(0);
      expect(m.run('aaaa').isRight()).to.be.true;
      expect(m.run('aaaa').value).to.equal(4);
    });

    it('chain', () => {
      const f = (s: string) => s.length > 0 ?
        K.of<Error, void, number>(s.length) :
        K.fail<Error, void, number>(new Error('empty string'));

      expect(K.of<Error, void, string>('aaa').chain(f).run().isRight()).to.be.true;
      expect(K.of<Error, void, string>('aaa').chain(f).run().value).to.equal(3);
      expect(K.of<Error, void, string>('').chain(f).run().isLeft()).to.be.true;
      expect(K.of<Error, void, string>('').chain(f).run().value as Error)
        .to.be.an.instanceOf(Error)
        .and
        .to.have.property('message').equal('empty string');
    });

    it('point', () => {
      const m = K.point<never, void, number>(() => 42);

      expect(m.run().isRight()).to.be.true;
      expect(m.run().value).to.equal(42);
    });

    it('fail', () => {
      const m = K.fail(new Error('fail'));

      expect(m.run({}).isLeft()).to.be.true;
      expect(m.run({}).value).to.be.an.instanceOf(Error).and.to.have.property('message').equal('fail');
    });
  });
});
