'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');
const { Game, GameError, randomCode } = require('./lib/game');
const { QuizStore } = require('./lib/store');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = process.env.PUBQUIZ_DATA || path.join(ROOT, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const SAMPLE_QUIZ = path.join(ROOT, 'sample-quiz.json');

const MIME = {
	'.html': 'text/html; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.js': 'application/javascript; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.gif': 'image/gif',
	'.webp': 'image/webp',
	'.ico': 'image/x-icon'
};

const IMAGE_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };

function createServer(options) {
	options = options || {};
	const store = new QuizStore(path.join(DATA_DIR, 'quizzes'));
	fs.mkdirSync(UPLOAD_DIR, { recursive: true });
	if (!store.list().length && fs.existsSync(SAMPLE_QUIZ)) {
		store.save(null, JSON.parse(fs.readFileSync(SAMPLE_QUIZ, 'utf8')));
	}

	const games = new Map();

	const cleanup = setInterval(() => {
		const cutoff = Date.now() - 12 * 60 * 60 * 1000;
		for (const [code, game] of games) {
			if (game.lastActivity < cutoff) {
				game.dispose();
				games.delete(code);
			}
		}
	}, 10 * 60 * 1000);
	cleanup.unref();

	function newCode() {
		for (let i = 0; i < 1000; i++) {
			const code = randomCode(4);
			if (!games.has(code)) {
				return code;
			}
		}
		throw new GameError(503, 'Geen vrije spelcode beschikbaar.');
	}

	function getGame(code) {
		const game = games.get(String(code).toUpperCase());
		if (!game) {
			throw new GameError(404, 'Spel niet gevonden. Controleer de code.');
		}
		return game;
	}

	function getQuiz(id) {
		const quiz = store.get(id);
		if (!quiz) {
			throw new GameError(404, 'Quiz niet gevonden.');
		}
		return quiz;
	}

	const routes = [
		['GET', /^\/api\/info$/, (req) => ({ lanUrls: lanUrls(req.socket.localPort) })],
		['GET', /^\/api\/quizzes$/, () => store.list()],
		['GET', /^\/api\/quizzes\/([a-f0-9]{12})$/, (req, m) => getQuiz(m[1])],
		['POST', /^\/api\/quizzes$/, async (req) => store.save(null, await readJson(req, 2e6))],
		['PUT', /^\/api\/quizzes\/([a-f0-9]{12})$/, async (req, m) => {
			getQuiz(m[1]);
			return store.save(m[1], await readJson(req, 2e6));
		}],
		['DELETE', /^\/api\/quizzes\/([a-f0-9]{12})$/, (req, m) => {
			if (!store.remove(m[1])) {
				throw new GameError(404, 'Quiz niet gevonden.');
			}
			return { ok: true };
		}],
		['POST', /^\/api\/uploads$/, async (req) => {
			const body = await readJson(req, 8e6);
			const match = /^data:(image\/[a-z]+);base64,([A-Za-z0-9+/=]+)$/.exec(String(body.dataUrl || ''));
			if (!match || !IMAGE_TYPES[match[1]]) {
				throw new GameError(400, 'Alleen PNG, JPEG, GIF of WebP afbeeldingen.');
			}
			const buffer = Buffer.from(match[2], 'base64');
			if (buffer.length > 5 * 1024 * 1024) {
				throw new GameError(413, 'Afbeelding is groter dan 5 MB.');
			}
			const name = crypto.randomBytes(12).toString('hex') + '.' + IMAGE_TYPES[match[1]];
			fs.writeFileSync(path.join(UPLOAD_DIR, name), buffer);
			return { url: '/uploads/' + name };
		}],
		['POST', /^\/api\/games$/, async (req) => {
			const body = await readJson(req, 1e4);
			const quiz = getQuiz(String(body.quizId || ''));
			const code = newCode();
			const game = new Game(code, quiz);
			games.set(code, game);
			return { code, hostToken: game.hostToken };
		}],
		['GET', /^\/api\/games\/([A-Za-z]{4})$/, (req, m) => {
			const game = getGame(m[1]);
			return { code: game.code, title: game.quiz.title, phase: game.phase };
		}],
		['GET', /^\/api\/games\/([A-Za-z]{4})\/check$/, (req, m, url) => {
			identify(getGame(m[1]), url);
			return { ok: true };
		}],
		['POST', /^\/api\/games\/([A-Za-z]{4})\/join$/, async (req, m) => {
			const game = getGame(m[1]);
			const body = await readJson(req, 1e4);
			const team = game.join(body.name);
			game.broadcast();
			return { teamId: team.id, token: team.token, name: team.name };
		}],
		['POST', /^\/api\/games\/([A-Za-z]{4})\/answer$/, async (req, m) => {
			const game = getGame(m[1]);
			const body = await readJson(req, 1e4);
			if (!game.authTeam(body.teamId, body.token)) {
				throw new GameError(403, 'Je team is niet (meer) aangemeld.');
			}
			game.submitAnswer(body.teamId, body.value);
			game.broadcast();
			return { ok: true };
		}],
		['POST', /^\/api\/games\/([A-Za-z]{4})\/action$/, async (req, m) => {
			const game = getGame(m[1]);
			const body = await readJson(req, 1e4);
			if (body.token !== game.hostToken) {
				throw new GameError(403, 'Alleen de quizmaster mag dit.');
			}
			switch (body.action) {
				case 'next': game.next(); break;
				case 'end': game.end(); break;
				case 'verdict': game.setVerdict(body.teamId, body.correct); break;
				case 'adjust': game.adjust(body.teamId, body.delta); break;
				case 'kick': game.removeTeam(body.teamId); break;
				case 'stop':
					game.dispose();
					games.delete(game.code);
					return { ok: true };
				default: throw new GameError(400, 'Onbekende actie.');
			}
			game.broadcast();
			return { ok: true };
		}]
	];

	// Works out who is connecting; throws 403 on bad credentials.
	function identify(game, url) {
		const role = url.searchParams.get('role');
		const token = url.searchParams.get('token');
		if (role === 'host') {
			if (token !== game.hostToken) {
				throw new GameError(403, 'Alleen de quizmaster mag dit.');
			}
			return { role: 'host', teamId: null };
		}
		if (role === 'team') {
			const teamId = url.searchParams.get('team');
			if (!game.authTeam(teamId, token)) {
				throw new GameError(403, 'Je team is niet (meer) aangemeld.');
			}
			return { role: 'team', teamId };
		}
		return { role: 'screen', teamId: null };
	}

	function handleStream(req, res, code, url) {
		const game = getGame(code);
		const listener = identify(game, url);
		res.writeHead(200, {
			'Content-Type': 'text/event-stream; charset=utf-8',
			'Cache-Control': 'no-cache, no-transform',
			'Connection': 'keep-alive',
			'X-Accel-Buffering': 'no'
		});
		res.write('retry: 2000\n\n');
		listener.send = (data) => res.write('data: ' + JSON.stringify(data) + '\n\n');
		listener.close = () => res.end();
		const heartbeat = setInterval(() => res.write(': ping\n\n'), 20000);
		req.on('close', () => {
			clearInterval(heartbeat);
			game.removeListener(listener);
		});
		game.addListener(listener);
	}

	async function handle(req, res) {
		const url = new URL(req.url, 'http://localhost');
		let pathname;
		try {
			pathname = decodeURIComponent(url.pathname);
		} catch (e) {
			throw new GameError(400, 'Ongeldig adres.');
		}

		if (pathname.startsWith('/api/')) {
			const stream = /^\/api\/games\/([A-Za-z]{4})\/stream$/.exec(pathname);
			if (stream && req.method === 'GET') {
				return handleStream(req, res, stream[1], url);
			}
			for (const [method, pattern, fn] of routes) {
				const m = pattern.exec(pathname);
				if (m && method === req.method) {
					return sendJson(res, 200, await fn(req, m, url));
				}
			}
			throw new GameError(404, 'Niet gevonden.');
		}

		if (req.method !== 'GET' && req.method !== 'HEAD') {
			throw new GameError(405, 'Methode niet toegestaan.');
		}
		if (pathname.startsWith('/uploads/')) {
			return serveFile(res, UPLOAD_DIR, pathname.slice('/uploads'.length), true);
		}
		return serveFile(res, PUBLIC_DIR, pathname === '/' ? '/index.html' : pathname, false);
	}

	const server = http.createServer((req, res) => {
		handle(req, res).catch((err) => {
			const status = err.status || 500;
			if (status === 500) {
				console.error(err);
			}
			if (res.headersSent) {
				return res.end();
			}
			sendJson(res, status, { error: status === 500 ? 'Er ging iets mis op de server.' : err.message });
		});
	});
	server.games = games;
	server.store = store;
	return server;
}

function lanUrls(port) {
	const os = require('os');
	const urls = [];
	for (const list of Object.values(os.networkInterfaces())) {
		for (const addr of list || []) {
			if (addr.family === 'IPv4' && !addr.internal) {
				urls.push('http://' + addr.address + ':' + port);
			}
		}
	}
	return urls;
}

function sendJson(res, status, data) {
	const body = JSON.stringify(data);
	res.writeHead(status, {
		'Content-Type': 'application/json; charset=utf-8',
		'Cache-Control': 'no-store',
		'Content-Length': Buffer.byteLength(body)
	});
	res.end(body);
}

function serveFile(res, baseDir, relPath, immutable) {
	const file = path.normalize(path.join(baseDir, relPath));
	if (!file.startsWith(baseDir + path.sep)) {
		throw new GameError(404, 'Niet gevonden.');
	}
	return new Promise((resolve, reject) => {
		fs.stat(file, (err, stats) => {
			if (err || !stats.isFile()) {
				return reject(new GameError(404, 'Niet gevonden.'));
			}
			res.writeHead(200, {
				'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
				'Content-Length': stats.size,
				'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
				'X-Content-Type-Options': 'nosniff'
			});
			fs.createReadStream(file).on('error', reject).on('end', resolve).pipe(res);
		});
	});
}

function readJson(req, limit) {
	return new Promise((resolve, reject) => {
		let size = 0;
		const chunks = [];
		req.on('data', (chunk) => {
			size += chunk.length;
			if (size > limit) {
				reject(new GameError(413, 'Verzoek is te groot.'));
				req.destroy();
				return;
			}
			chunks.push(chunk);
		});
		req.on('end', () => {
			if (!chunks.length) {
				return resolve({});
			}
			try {
				resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
			} catch (e) {
				reject(new GameError(400, 'Ongeldige JSON.'));
			}
		});
		req.on('error', reject);
	});
}

module.exports = { createServer };

if (require.main === module) {
	const port = Number(process.env.PORT) || 3000;
	createServer().listen(port, () => {
		console.log('Pub quiz draait op http://localhost:' + port);
		for (const url of lanUrls(port)) {
			console.log('Teams in hetzelfde netwerk: ' + url + '/play.html');
		}
	});
}
