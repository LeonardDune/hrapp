'use strict';

const LETTERS = 'ABCDEFGH';

// Build DOM without innerHTML so user text is never parsed as HTML.
function el(tag, attrs, ...children) {
	const node = document.createElement(tag);
	for (const [key, value] of Object.entries(attrs || {})) {
		if (value === null || value === undefined || value === false) {
			continue;
		}
		if (key === 'class') {
			node.className = value;
		} else if (key === 'style' && typeof value === 'object') {
			Object.assign(node.style, value);
		} else if (key === 'value') {
			node.value = value;
		} else if (key.startsWith('on')) {
			node.addEventListener(key.slice(2), value);
		} else if (key in node && typeof value !== 'string') {
			node[key] = value;
		} else {
			node.setAttribute(key, value === true ? '' : value);
		}
	}
	for (const child of children.flat(Infinity)) {
		if (child === null || child === undefined || child === false) {
			continue;
		}
		node.append(child instanceof Node ? child : document.createTextNode(String(child)));
	}
	return node;
}

async function api(method, url, body) {
	const res = await fetch(url, {
		method,
		headers: body ? { 'Content-Type': 'application/json' } : {},
		body: body ? JSON.stringify(body) : undefined
	});
	let data = null;
	try {
		data = await res.json();
	} catch (e) {
		data = null;
	}
	if (!res.ok) {
		const err = new Error((data && data.error) || 'Er ging iets mis (' + res.status + ').');
		err.status = res.status;
		throw err;
	}
	return data;
}

function store(key, value) {
	try {
		if (value === undefined) {
			const raw = localStorage.getItem(key);
			return raw ? JSON.parse(raw) : null;
		}
		if (value === null) {
			localStorage.removeItem(key);
		} else {
			localStorage.setItem(key, JSON.stringify(value));
		}
	} catch (e) {
		return null;
	}
	return value;
}

function optColor(i) {
	return 'var(--opt-' + (i % 8) + ')';
}

function letterBadge(i) {
	return el('span', { class: 'letter', style: { background: optColor(i) } }, LETTERS[i]);
}

// Live connection via Server-Sent Events. onState gets each new view;
// onGone fires when the game or the credentials no longer exist.
function connect(url, statusUrl, onState, onGone) {
	let source = null;
	let closed = false;
	function open() {
		source = new EventSource(url);
		source.onmessage = (event) => onState(JSON.parse(event.data));
		source.onerror = async () => {
			if (closed) {
				return;
			}
			source.close();
			try {
				await api('GET', statusUrl);
			} catch (err) {
				if (err.status === 404 || err.status === 403) {
					closed = true;
					return onGone(err);
				}
			}
			setTimeout(() => !closed && open(), 1500);
		};
	}
	open();
	return {
		close() {
			closed = true;
			if (source) {
				source.close();
			}
		}
	};
}

// Countdown that keeps running between server updates.
const clock = {
	offset: 0,
	sync(serverNow) {
		this.offset = serverNow - Date.now();
	},
	remaining(deadline) {
		if (!deadline) {
			return null;
		}
		return Math.max(0, Math.ceil((deadline - (Date.now() + this.offset)) / 1000));
	}
};

function timerNode(deadline) {
	const node = el('span', { class: 'timer' });
	function tick() {
		const left = clock.remaining(deadline);
		if (left === null || !node.isConnected && node.dataset.started) {
			return;
		}
		node.dataset.started = '1';
		node.textContent = left + 's';
		node.classList.toggle('low', left <= 5);
		if (left > 0) {
			setTimeout(tick, 250);
		}
	}
	if (deadline) {
		tick();
	}
	return node;
}

function scoreboardNode(rows, meId, limit) {
	const max = Math.max(1, ...rows.map((r) => r.score));
	const shown = limit ? rows.slice(0, limit) : rows;
	return el('ol', { class: 'scoreboard' }, shown.map((row) =>
		el('li', { class: (row.rank === 1 ? 'top1 ' : '') + (row.id === meId ? 'me' : '') },
			el('span', { class: 'bar', style: { width: Math.max(0, row.score / max * 100) + '%' } }),
			el('span', { class: 'rank' }, row.rank + '.'),
			el('span', { class: 'name' }, row.name),
			el('span', { class: 'pts' }, formatPoints(row.score))
		)
	));
}

function formatPoints(n) {
	return Number.isInteger(n) ? String(n) : n.toFixed(1).replace('.', ',');
}

function typeHint(type) {
	return {
		mc: 'Meerkeuze',
		open: 'Open vraag',
		estimate: 'Schatvraag: wie het dichtst in de buurt zit, wint'
	}[type] || '';
}
