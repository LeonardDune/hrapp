'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TYPES = ['mc', 'open', 'estimate'];

function str(value, max) {
	return String(value === undefined || value === null ? '' : value).slice(0, max);
}

function cleanImage(value) {
	const url = str(value, 2000).trim();
	if (!url) {
		return '';
	}
	if (/^\/(uploads|img)\/[a-z0-9-]+\.(png|jpe?g|gif|webp|svg)$/.test(url) || /^https?:\/\/\S+$/i.test(url)) {
		return url;
	}
	return '';
}

function normalizeQuestion(raw) {
	raw = raw || {};
	const type = TYPES.includes(raw.type) ? raw.type : 'mc';
	const question = {
		type,
		text: str(raw.text, 1000).trim(),
		image: cleanImage(raw.image),
		points: Math.max(0, Math.min(100, Math.round(Number(raw.points)) || 0)) || 1,
		timeLimit: Math.max(0, Math.min(3600, Math.round(Number(raw.timeLimit)) || 0))
	};
	if (type === 'mc') {
		let options = Array.isArray(raw.options) ? raw.options.map((o) => str(o, 200)) : [];
		options = options.slice(0, 8);
		while (options.length < 2) {
			options.push('');
		}
		question.options = options;
		const correct = Math.round(Number(raw.correct));
		question.correct = correct >= 0 && correct < options.length ? correct : 0;
	} else if (type === 'open') {
		question.answer = str(raw.answer, 200).trim();
		question.alternatives = (Array.isArray(raw.alternatives) ? raw.alternatives : [])
			.map((a) => str(a, 200).trim())
			.filter(Boolean)
			.slice(0, 20);
	} else {
		const n = Number(String(raw.answer).replace(',', '.'));
		question.answer = Number.isFinite(n) ? n : 0;
	}
	return question;
}

function normalizeQuiz(raw) {
	raw = raw || {};
	const rounds = (Array.isArray(raw.rounds) ? raw.rounds : []).slice(0, 50).map((round, i) => ({
		title: str(round && round.title, 200).trim() || 'Ronde ' + (i + 1),
		questions: (Array.isArray(round && round.questions) ? round.questions : []).slice(0, 200).map(normalizeQuestion)
	}));
	return {
		title: str(raw.title, 200).trim() || 'Naamloze quiz',
		rounds
	};
}

class QuizStore {
	constructor(dir) {
		this.dir = dir;
		fs.mkdirSync(dir, { recursive: true });
	}

	file(id) {
		if (!/^[a-f0-9]{12}$/.test(id)) {
			return null;
		}
		return path.join(this.dir, id + '.json');
	}

	list() {
		return fs.readdirSync(this.dir)
			.filter((f) => /^[a-f0-9]{12}\.json$/.test(f))
			.map((f) => this.get(f.slice(0, 12)))
			.filter(Boolean)
			.map((q) => ({
				id: q.id,
				title: q.title,
				updatedAt: q.updatedAt,
				rounds: q.rounds.length,
				questions: q.rounds.reduce((n, r) => n + r.questions.length, 0)
			}))
			.sort((a, b) => b.updatedAt - a.updatedAt);
	}

	get(id) {
		const file = this.file(id);
		if (!file || !fs.existsSync(file)) {
			return null;
		}
		try {
			return JSON.parse(fs.readFileSync(file, 'utf8'));
		} catch (e) {
			return null;
		}
	}

	save(id, raw) {
		const quiz = normalizeQuiz(raw);
		quiz.id = id || crypto.randomBytes(6).toString('hex');
		quiz.updatedAt = Date.now();
		const file = this.file(quiz.id);
		const tmp = file + '.' + process.pid + '.tmp';
		fs.writeFileSync(tmp, JSON.stringify(quiz, null, 2));
		fs.renameSync(tmp, file);
		return quiz;
	}

	remove(id) {
		const file = this.file(id);
		if (!file || !fs.existsSync(file)) {
			return false;
		}
		fs.unlinkSync(file);
		return true;
	}
}

module.exports = { QuizStore, normalizeQuiz, normalizeQuestion };
