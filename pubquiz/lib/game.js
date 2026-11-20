'use strict';

const crypto = require('crypto');

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

function randomToken() {
	return crypto.randomBytes(16).toString('hex');
}

function randomCode(length) {
	let code = '';
	const bytes = crypto.randomBytes(length);
	for (let i = 0; i < length; i++) {
		code += CODE_CHARS[bytes[i] % CODE_CHARS.length];
	}
	return code;
}

// Lowercase, strip accents and punctuation so "Beyoncé!" matches "beyonce".
function normalizeText(value) {
	return String(value || '')
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();
}

function parseNumber(value) {
	if (typeof value === 'number') {
		return Number.isFinite(value) ? value : null;
	}
	const cleaned = String(value || '').trim().replace(/\s/g, '').replace(',', '.');
	if (!/^-?\d+(\.\d+)?$/.test(cleaned)) {
		return null;
	}
	return Number(cleaned);
}

const LETTERS = 'ABCDEFGH';

function answerText(question, value) {
	if (value === undefined || value === null) {
		return '';
	}
	if (question.type === 'mc') {
		return LETTERS[value] + ': ' + (question.options[value] || '');
	}
	return String(value);
}

function correctText(question) {
	if (question.type === 'mc') {
		return answerText(question, question.correct);
	}
	if (question.type === 'estimate') {
		return String(question.answer);
	}
	return question.answer;
}

class Game {
	constructor(code, quiz, options) {
		options = options || {};
		this.code = code;
		this.quiz = JSON.parse(JSON.stringify(quiz));
		this.hostToken = randomToken();
		this.teams = new Map();
		this.items = [];
		this.quiz.rounds.forEach((round, roundIndex) => {
			round.questions.forEach((question, questionIndex) => {
				this.items.push({ roundIndex, questionIndex, question });
			});
		});
		this.pos = -1;
		this.phase = 'lobby';
		this.answers = this.items.map(() => new Map());
		this.verdicts = this.items.map(() => new Map());
		this.revealed = new Set();
		this.adjustments = new Map();
		this.deadline = null;
		this.timer = null;
		this.listeners = new Set();
		this.lastActivity = Date.now();
		this.now = options.now || Date.now;
	}

	// ---- teams -------------------------------------------------------------

	join(name) {
		name = String(name || '').trim().replace(/\s+/g, ' ').slice(0, 30);
		if (!name) {
			throw new GameError(400, 'Vul een teamnaam in.');
		}
		if (this.phase === 'end') {
			throw new GameError(409, 'Deze quiz is al afgelopen.');
		}
		const taken = [...this.teams.values()].some((t) => normalizeText(t.name) === normalizeText(name));
		if (taken) {
			throw new GameError(409, 'Die teamnaam is al bezet.');
		}
		const team = { id: randomToken().slice(0, 8), name, token: randomToken(), joinedAt: this.now() };
		this.teams.set(team.id, team);
		this.touch();
		return team;
	}

	authTeam(teamId, token) {
		const team = this.teams.get(teamId);
		if (!team || team.token !== token) {
			return null;
		}
		return team;
	}

	removeTeam(teamId) {
		if (!this.teams.delete(teamId)) {
			throw new GameError(404, 'Team niet gevonden.');
		}
		this.answers.forEach((m) => m.delete(teamId));
		this.verdicts.forEach((m) => m.delete(teamId));
		this.adjustments.delete(teamId);
		for (const listener of this.listeners) {
			if (listener.teamId === teamId) {
				listener.close();
			}
		}
	}

	// ---- answers -----------------------------------------------------------

	submitAnswer(teamId, rawValue) {
		if (this.phase !== 'question') {
			throw new GameError(409, 'Er staat nu geen vraag open.');
		}
		if (this.deadline && this.now() > this.deadline + 1000) {
			throw new GameError(409, 'De tijd is om.');
		}
		const question = this.current().question;
		let value;
		if (question.type === 'mc') {
			value = Number(rawValue);
			if (!Number.isInteger(value) || value < 0 || value >= question.options.length) {
				throw new GameError(400, 'Ongeldige keuze.');
			}
		} else if (question.type === 'estimate') {
			value = parseNumber(rawValue);
			if (value === null) {
				throw new GameError(400, 'Vul een getal in.');
			}
		} else {
			value = String(rawValue || '').trim().slice(0, 200);
			if (!value) {
				throw new GameError(400, 'Vul een antwoord in.');
			}
		}
		this.answers[this.pos].set(teamId, { value, at: this.now() });
		this.touch();
		return value;
	}

	autoJudge(index) {
		const question = this.items[index].question;
		const answers = this.answers[index];
		const verdicts = this.verdicts[index];
		verdicts.clear();
		if (question.type === 'mc') {
			for (const [teamId, a] of answers) {
				verdicts.set(teamId, a.value === question.correct);
			}
		} else if (question.type === 'open') {
			const accepted = [question.answer].concat(question.alternatives || [])
				.map(normalizeText)
				.filter(Boolean);
			for (const [teamId, a] of answers) {
				verdicts.set(teamId, accepted.includes(normalizeText(a.value)));
			}
		} else if (question.type === 'estimate') {
			let best = Infinity;
			for (const a of answers.values()) {
				best = Math.min(best, Math.abs(a.value - question.answer));
			}
			for (const [teamId, a] of answers) {
				verdicts.set(teamId, Math.abs(a.value - question.answer) === best);
			}
		}
	}

	setVerdict(teamId, correct) {
		if (this.pos < 0 || !['closed', 'reveal', 'scores'].includes(this.phase)) {
			throw new GameError(409, 'Beoordelen kan pas als de antwoorden gesloten zijn.');
		}
		if (!this.teams.has(teamId)) {
			throw new GameError(404, 'Team niet gevonden.');
		}
		this.verdicts[this.pos].set(teamId, Boolean(correct));
	}

	adjust(teamId, delta) {
		if (!this.teams.has(teamId)) {
			throw new GameError(404, 'Team niet gevonden.');
		}
		delta = Number(delta);
		if (!Number.isFinite(delta)) {
			throw new GameError(400, 'Ongeldige correctie.');
		}
		this.adjustments.set(teamId, (this.adjustments.get(teamId) || 0) + delta);
	}

	score(teamId) {
		let total = this.adjustments.get(teamId) || 0;
		for (const index of this.revealed) {
			if (this.verdicts[index].get(teamId)) {
				total += this.items[index].question.points;
			}
		}
		return total;
	}

	scoreboard() {
		const rows = [...this.teams.values()].map((t) => ({ id: t.id, name: t.name, score: this.score(t.id) }));
		rows.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
		let rank = 0;
		let prev = null;
		rows.forEach((row, i) => {
			if (row.score !== prev) {
				rank = i + 1;
				prev = row.score;
			}
			row.rank = rank;
		});
		return rows;
	}

	// ---- flow --------------------------------------------------------------

	current() {
		return this.items[this.pos];
	}

	isLastInRound() {
		const next = this.items[this.pos + 1];
		return !next || next.roundIndex !== this.current().roundIndex;
	}

	nextLabel() {
		switch (this.phase) {
			case 'lobby': return this.items.length ? 'Start quiz' : null;
			case 'round': return 'Eerste vraag';
			case 'question': return 'Antwoorden sluiten';
			case 'closed': return 'Antwoord tonen';
			case 'reveal': return this.isLastInRound() ? 'Tussenstand' : 'Volgende vraag';
			case 'scores': return this.pos + 1 < this.items.length ? 'Volgende ronde' : 'Eindstand';
			default: return null;
		}
	}

	next() {
		this.clearTimer();
		switch (this.phase) {
			case 'lobby':
				if (!this.items.length) {
					throw new GameError(409, 'Deze quiz heeft geen vragen.');
				}
				this.pos = 0;
				this.phase = 'round';
				break;
			case 'round':
				this.openQuestion();
				break;
			case 'question':
				this.closeQuestion();
				break;
			case 'closed':
				this.revealed.add(this.pos);
				this.phase = 'reveal';
				break;
			case 'reveal':
				if (this.isLastInRound()) {
					this.phase = 'scores';
				} else {
					this.pos++;
					this.openQuestion();
				}
				break;
			case 'scores':
				if (this.pos + 1 < this.items.length) {
					this.pos++;
					this.phase = 'round';
				} else {
					this.phase = 'end';
				}
				break;
			default:
				throw new GameError(409, 'De quiz is afgelopen.');
		}
		this.touch();
	}

	openQuestion() {
		this.phase = 'question';
		const limit = this.current().question.timeLimit;
		if (limit > 0) {
			this.deadline = this.now() + limit * 1000;
			const pos = this.pos;
			this.timer = setTimeout(() => {
				this.timer = null;
				if (this.phase === 'question' && this.pos === pos) {
					this.closeQuestion();
					this.broadcast();
				}
			}, limit * 1000 + 1000);
		} else {
			this.deadline = null;
		}
	}

	closeQuestion() {
		this.clearTimer();
		this.deadline = null;
		this.phase = 'closed';
		this.autoJudge(this.pos);
	}

	clearTimer() {
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = null;
		}
	}

	end() {
		this.clearTimer();
		if (this.pos >= 0 && ['closed'].includes(this.phase)) {
			this.revealed.add(this.pos);
		}
		this.phase = 'end';
		this.touch();
	}

	touch() {
		this.lastActivity = Date.now();
	}

	// ---- views -------------------------------------------------------------

	publicView() {
		const item = this.pos >= 0 ? this.current() : null;
		const round = item ? this.quiz.rounds[item.roundIndex] : null;
		const view = {
			code: this.code,
			title: this.quiz.title,
			phase: this.phase,
			serverNow: this.now(),
			deadline: this.deadline,
			totalQuestions: this.items.length,
			roundCount: this.quiz.rounds.filter((r) => r.questions.length).length,
			teams: [...this.teams.values()].map((t) => ({ id: t.id, name: t.name })),
			scoreboard: this.scoreboard(),
			round: null,
			question: null,
			answeredCount: 0,
			reveal: null
		};
		if (item) {
			const inRound = this.items.filter((it) => it.roundIndex === item.roundIndex);
			view.round = {
				number: this.items.slice(0, this.pos + 1).reduce((set, it) => set.add(it.roundIndex), new Set()).size,
				title: round.title,
				questionCount: inRound.length
			};
		}
		if (item && ['question', 'closed', 'reveal'].includes(this.phase)) {
			const q = item.question;
			view.question = {
				number: item.questionIndex + 1,
				type: q.type,
				text: q.text,
				image: q.image || '',
				options: q.type === 'mc' ? q.options.slice() : [],
				points: q.points,
				timeLimit: q.timeLimit
			};
			view.answeredCount = this.answers[this.pos].size;
		}
		if (item && this.phase === 'reveal') {
			const q = item.question;
			view.reveal = {
				correctText: correctText(q),
				correctIndex: q.type === 'mc' ? q.correct : null,
				results: [...this.teams.values()].map((t) => {
					const a = this.answers[this.pos].get(t.id);
					return {
						name: t.name,
						answered: Boolean(a),
						answerText: a ? answerText(q, a.value) : '',
						correct: Boolean(this.verdicts[this.pos].get(t.id))
					};
				})
			};
		}
		return view;
	}

	hostView() {
		const view = this.publicView();
		view.nextLabel = this.nextLabel();
		const item = this.pos >= 0 ? this.current() : null;
		if (item && ['question', 'closed', 'reveal', 'scores'].includes(this.phase)) {
			const q = item.question;
			view.hostQuestion = {
				text: q.text,
				type: q.type,
				correctText: correctText(q),
				judgeable: this.phase !== 'question'
			};
			view.answers = [...this.teams.values()].map((t) => {
				const a = this.answers[this.pos].get(t.id);
				return {
					teamId: t.id,
					name: t.name,
					answered: Boolean(a),
					answerText: a ? answerText(q, a.value) : '',
					correct: this.verdicts[this.pos].has(t.id) ? this.verdicts[this.pos].get(t.id) : null
				};
			});
		}
		view.adjustments = Object.fromEntries(this.adjustments);
		return view;
	}

	teamView(teamId) {
		const view = this.publicView();
		const team = this.teams.get(teamId);
		const row = view.scoreboard.find((r) => r.id === teamId);
		view.me = { id: team.id, name: team.name, score: row.score, rank: row.rank };
		if (this.pos >= 0 && view.question) {
			const q = this.current().question;
			const a = this.answers[this.pos].get(teamId);
			view.myAnswer = a ? { value: a.value, text: answerText(q, a.value) } : null;
			if (this.phase === 'reveal') {
				view.myCorrect = Boolean(this.verdicts[this.pos].get(teamId));
			}
		}
		return view;
	}

	// ---- live updates ------------------------------------------------------

	addListener(listener) {
		this.listeners.add(listener);
		listener.send(this.viewFor(listener));
	}

	removeListener(listener) {
		this.listeners.delete(listener);
	}

	viewFor(listener) {
		if (listener.role === 'host') {
			return this.hostView();
		}
		if (listener.role === 'team') {
			return this.teamView(listener.teamId);
		}
		return this.publicView();
	}

	broadcast() {
		for (const listener of this.listeners) {
			if (listener.role === 'team' && !this.teams.has(listener.teamId)) {
				continue;
			}
			listener.send(this.viewFor(listener));
		}
	}

	dispose() {
		this.clearTimer();
		for (const listener of this.listeners) {
			listener.close();
		}
		this.listeners.clear();
	}
}

class GameError extends Error {
	constructor(status, message) {
		super(message);
		this.status = status;
	}
}

module.exports = { Game, GameError, randomCode, randomToken, normalizeText, parseNumber };
