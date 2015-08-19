'use strict';

var request = require('request');
var StreamCache = require('stream-cache');
var streamForward = require('stream-forward');
var through = require('through2');

var DEFAULTS = {
  request: request,
  retries: 2,
  shouldRetryFn: function (response) {
    // Not a successful status or redirect.
    return response.statusCode < 200 || response.statusCode >= 400;
  }
};

var REQUEST_EVENTS = [
  'error',
  'complete',
  'response'
];

function retryRequest(requestOpts, opts, callback) {
  var streamMode = typeof arguments[arguments.length - 1] !== 'function';

  if (typeof opts === 'function') {
    callback = opts;
  }

  opts = opts || DEFAULTS;

  if (typeof opts.request === 'undefined') {
    opts.request = DEFAULTS.request;
  }
  if (typeof opts.retries !== 'number') {
    opts.retries = DEFAULTS.retries;
  }
  if (typeof opts.shouldRetryFn !== 'function') {
    opts.shouldRetryFn = DEFAULTS.shouldRetryFn;
  }

  var numAttempts = 0;

  var retryStream;
  var requestStream;
  var cacheStream;

  if (streamMode) {
    retryStream = through();
    retryStream.abort = resetStreams;
  }

  makeRequest();

  if (streamMode) {
    return retryStream;
  }

  function resetStreams() {
    cacheStream = null;

    if (requestStream) {
      requestStream.abort();
      requestStream.destroy();
    }
  }

  function makeRequest() {
    numAttempts++;

    if (streamMode) {
      cacheStream = new StreamCache();
      requestStream = opts.request(requestOpts);

      streamForward(requestStream, { events: REQUEST_EVENTS })
        .on('error', onResponse)
        .on('response', onResponse.bind(null, null))
        .pipe(cacheStream);
    } else {
      opts.request(requestOpts, onResponse);
    }
  }

  function onResponse(err, response, body) {
    // An error such as DNS resolution.
    if (err) {
      if (streamMode) {
        retryStream.emit('error', err);
        retryStream.end();
      } else {
        callback(err, response, body);
      }

      return;
    }

    // Send the response to see if we should try again.
    if (numAttempts <= opts.retries && opts.shouldRetryFn(response)) {
      if (streamMode) {
        resetStreams();
      }

      setTimeout(makeRequest, getNextRetryDelay(numAttempts));
      return;
    }

    // No more attempts need to be made, just continue on.
    if (streamMode) {
      streamForward(cacheStream, { events: REQUEST_EVENTS })
        .pipe(retryStream)
        .on('error', resetStreams);
    } else {
      callback(err, response, body);
    }
  }
}

module.exports = retryRequest;

function getNextRetryDelay(retryNumber) {
  return (Math.pow(2, retryNumber) * 1000) + Math.floor(Math.random() * 1000);
}

module.exports.getNextRetryDelay = getNextRetryDelay;
