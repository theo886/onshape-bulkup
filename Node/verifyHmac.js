#!/usr/bin/env node
/**
 * verifyHmac.js — Computes the exact same HMAC as the Rust debug_auth command
 * using the credentials from apikey.js, so you can compare signatures.
 *
 * Run: node verifyHmac.js
 * Then compare the output with the Debug Auth panel in Onshape Console.
 */

var crypto = require('crypto');
var apikey = require('./config/apikey.js');

// Same fixed values as Rust build_headers_debug()
var method = 'GET';
var nonce = 'AAAAAAAAAAAAAAAAAAAAAAAAA';
var authDate = 'Mon, 01 Jan 2024 00:00:00 GMT';
var contentType = 'application/json';
var path = '/api/v10/companies';
var queryString = '';

var hmacString = (method + '\n' + nonce + '\n' + authDate + '\n' +
  contentType + '\n' + path + '\n' + queryString + '\n').toLowerCase();

var hmac = crypto.createHmac('sha256', apikey.secretKey);
hmac.update(hmacString);
var signature = hmac.digest('base64');
var authHeader = 'On ' + apikey.accessKey + ':HmacSHA256:' + signature;

console.log('=== Node.js HMAC Verification ===');
console.log('Access key length:', apikey.accessKey.length);
console.log('Secret key length:', apikey.secretKey.length);
console.log('Base URL:', apikey.baseUrl);
console.log('');
console.log('HMAC Input String:');
console.log(hmacString);
console.log('Signature (base64):', signature);
console.log('Authorization Header:', authHeader);
console.log('');
console.log('Access key first 8 chars:', apikey.accessKey.substring(0, 8));
console.log('Secret key first 8 chars:', apikey.secretKey.substring(0, 8));
