/*var express = require('express');
var path = require('path');
var favicon = require('serve-favicon');
var logger = require('morgan');
var cookieParser = require('cookie-parser');
var bodyParser = require('body-parser');

var routes = require('./routes/index');
var users = require('./routes/users');

var app = express();

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'jade');

// uncomment after placing your favicon in /public
//app.use(favicon(path.join(__dirname, 'public', 'favicon.ico')));
app.use(logger('dev'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/', routes);
app.use('/users', users);

// catch 404 and forward to error handler
app.use(function(req, res, next) {
  var err = new Error('Not Found');
  err.status = 404;
  next(err);
});

// error handlers

// development error handler
// will print stacktrace
if (app.get('env') === 'development') {
  app.use(function(err, req, res, next) {
    res.status(err.status || 500);
    res.render('error', {
      message: err.message,
      error: err
    });
  });
}

// production error handler
// no stacktraces leaked to user
app.use(function(err, req, res, next) {
  res.status(err.status || 500);
  res.render('error', {
    message: err.message,
    error: {}
  });
});


module.exports = app; */

var http = require('http');

http.createServer(function (req, res) {
	var _url;
	
	req.method = req.method.toUpperCase();
	console.log(req.method + ' ' + req.url);
	
	if (req.method !== 'GET') {
		res.writeHead(501, {
			'Content-Type' : 'text/plain'
		});
		return res.end(req.method + ' is not implemented by this server.');
	}
	
	if (_url = /^\/employees$/i.exec(req.url)) {
		// return a list of employees
		res.writeHead(200);
		return res.end('employee list');
	} else if (_url = /^\/employees\/(\d+)$/i.exec(req.url)) {
		// find the employee by the id in the route
		res.writeHead(200);
		return res.end('a single employee');
	} else {
		// try to send the static file
		res.writeHead(200);
		res.end('static file maybe');
	}
}).listen(1337, '127.0.0.1');

console.log('Server running at http://127.0.0.1:1337/');