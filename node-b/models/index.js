var mongoose = require('mongoose');
mongoose.set('debug', true);
mongoose.connect('mongodb://localhost/app-api');

mongoose.Promise = Promise  

module.exports.App = require('./app')