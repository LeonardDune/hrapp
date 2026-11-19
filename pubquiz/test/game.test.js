'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { Game, normalizeText, parseNumber } = require('../lib/game');
const { normalizeQuiz } = require('../lib/store');

const quiz = normalizeQuiz({
	title: 'Test',
	rounds: [
		{ title: 'R1', questions: [
			{ type: 'mc', text: 'Q1', options: ['a', 'b', 'c'], correct: 1, points: 1 },
			{ type: 'open', text: 'Q2', answer: 'Beyoncé', alternatives: ['Queen B'], points: 2 }
		] },
		{ title: 'R2', questions: [
			{ type: 'estimate', text: 'Q3', answer: 100, points: 3 }
		] }
	]
});

test('normalizeText strips accents and punctuation', () => {
	assert.strictEqual(normalizeText('  Beyoncé! '), 'beyonce');
	assert.strictEqual(normalizeText('Queen-B'), 'queen b');
});

test('parseNumber accepts comma decimals', () => {
	assert.strictEqual(parseNumber('3,5'), 3.5);
	assert.strictEqual(parseNumber('1 000'), 1000);
	assert.strictEqual(parseNumber('abc'), null);
});

test('full game flow with auto judging and scores', () => {
	const g = new Game('ABCD', quiz);
	const a = g.join('Team A');
	const b = g.join('Team B');
	assert.throws(() => g.join('team a'), /bezet/);

	assert.strictEqual(g.nextLabel(), 'Start quiz');
	g.next(); assert.strictEqual(g.phase, 'round');
	g.next(); assert.strictEqual(g.phase, 'question');

	// correct answer is hidden from teams while the question is open
	assert.strictEqual(g.teamView(a.id).reveal, null);
	assert.ok(!JSON.stringify(g.publicView()).includes('"correct"'));

	g.submitAnswer(a.id, 1);
	g.submitAnswer(b.id, 0);
	assert.throws(() => g.submitAnswer(a.id, 7), /Ongeldige/);
	g.next(); assert.strictEqual(g.phase, 'closed');
	assert.throws(() => g.submitAnswer(a.id, 1), /geen vraag/);
	assert.strictEqual(g.score(a.id), 0, 'no points before reveal');
	g.next(); assert.strictEqual(g.phase, 'reveal');
	assert.strictEqual(g.score(a.id), 1);
	assert.strictEqual(g.score(b.id), 0);
	assert.strictEqual(g.teamView(a.id).myCorrect, true);

	g.next(); // Q2 open
	g.submitAnswer(a.id, 'beyonce');
	g.submitAnswer(b.id, 'queen b!');
	g.next(); // closed
	g.setVerdict(b.id, false); // host overrides
	g.next(); // reveal
	assert.strictEqual(g.score(a.id), 3);
	assert.strictEqual(g.score(b.id), 0);
	assert.strictEqual(g.nextLabel(), 'Tussenstand');
	g.next(); assert.strictEqual(g.phase, 'scores');

	g.next(); assert.strictEqual(g.phase, 'round');
	assert.strictEqual(g.publicView().round.number, 2);
	g.next(); // Q3
	g.submitAnswer(a.id, '80');
	g.submitAnswer(b.id, '110,5');
	g.next(); g.next(); // closed, reveal
	assert.strictEqual(g.score(b.id), 3);
	assert.strictEqual(g.score(a.id), 3);
	g.adjust(a.id, 1);
	g.next(); assert.strictEqual(g.phase, 'scores');
	g.next(); assert.strictEqual(g.phase, 'end');
	const board = g.scoreboard();
	assert.deepStrictEqual(board.map((r) => [r.name, r.score, r.rank]), [['Team A', 4, 1], ['Team B', 3, 2]]);
});

test('estimate ties both win', () => {
	const g = new Game('EFGH', normalizeQuiz({ rounds: [{ questions: [{ type: 'estimate', text: 'x', answer: 10 }] }] }));
	const a = g.join('A');
	const b = g.join('B');
	const c = g.join('C');
	g.next(); g.next();
	g.submitAnswer(a.id, 8);
	g.submitAnswer(b.id, 12);
	g.submitAnswer(c.id, 20);
	g.next();
	assert.deepStrictEqual([a, b, c].map((t) => g.verdicts[0].get(t.id)), [true, true, false]);
});

test('timer closes the question', async () => {
	let now = 1000;
	const g = new Game('IJKL', normalizeQuiz({ rounds: [{ questions: [{ type: 'mc', text: 'x', options: ['a', 'b'], timeLimit: 5 }] }] }), { now: () => now });
	const t = g.join('A');
	g.next(); g.next();
	assert.ok(g.deadline);
	now += 7000;
	assert.throws(() => g.submitAnswer(t.id, 0), /tijd is om/);
	g.dispose();
});

test('normalizeQuiz sanitizes input', () => {
	const q = normalizeQuiz({ rounds: [{ questions: [
		{ type: 'evil', text: 'x', image: 'javascript:alert(1)', options: ['a'], correct: 9, points: -5 }
	] }] });
	const question = q.rounds[0].questions[0];
	assert.strictEqual(question.type, 'mc');
	assert.strictEqual(question.image, '');
	assert.strictEqual(question.options.length, 2);
	assert.strictEqual(question.correct, 0);
	assert.strictEqual(question.points, 1);
});
