"use strict";

const {Cu} = require("chrome");
Cu.import("resource://gre/modules/Task.jsm");
Cu.import("resource://gre/modules/Promise.jsm");

function NotImplementedError(message) {
   this.message = message;
   this.name = "NotImplementedError";
   this.toString = function() {
      return this.name + " " + this.message;
   };
}

function Node(identifier, listenType, emitType) {
  this.identifier = identifier;
  this.listenType = listens;
  this.emitType = emits;
  this.emitDeferred = Promise.defer();
  this.results = null;
  this.initted = false;
}

Node.prototype = {
  /*
   * A Node consumes data and returns a promise when it is done processing.
   *
   * Bolts and Spouts are implemented using the Node object.
   *
   * A Bolt is defined as a Node that returns a result as soon as a message is
   * ingested.
   *
   * A Spout is defined as a Node that returns a result eventually, when
   * a certain condition is met and emitReady is true.
   *
   * When implementing a Spout, create a condition by overriding emitReady.
   * When implementing a Bolt, leave emitReady as-is.
   */

  consume: function _Node_consume(message, flush) {
    /*
     * Process a message. Starts an ingestion chain in the topology.
     * @param   message   message to be consumed
     * @param   flush     whether to wait until emitReady
     * @returns a promise that resolves when processing is complete
     */
    if (!this.initted) {
      this.init();
      this.initted = true;
    }
    if (message) {
      this.ingest(message);
    }
    if (this.emitReady() || flush) {
      let deferred = this.emitDeferred;
      let results = this.flush();
      deferred.resolve(results);
      this.clear();
      return deferred.promise;
    }
    return this.emitDeferred.promise;
  },

  ingest: function _Node_ingest(message) {
    /*
     * Takes a message to be processed
     */
    throw new NotImplementedError("ingest implementation not found");
  },

  emitReady: function _Node_emitReady() {
    /*
     * Returns when output should be flushed
     * @returns boolean
     */
    return true;
  },

  flush: function _Node_flush() {
    /*
     * Emit a message. The emit "buffer" will be cleared after this is called.
     * @returns a resolved promise
     */
    let results = this.results;
    return results;
  },

  clear: function _Node_clear() {
    /*
     * Clear any temporary data
     */
    this.results = null;
    this.emitDeferred = Promise.defer();
  },

  init: function _Node_init() {
    /*
     * Optional initialization that runs when consume is called for the first time.
     */
  }
}

function createNode(options, locals) {
  function EasyNode() {
    this.results = null;
    this.emitDeferred = Promise.defer();

    for (let key in locals) {
      this[key] = locals[key];
    }
  }
  let properties = {};
  for (let key in options) {
    properties[key] = {value: options[key]};
  }
  EasyNode.prototype = Object.create(Node.prototype, properties);
  return new EasyNode();
}

function Stream() {
  this.objects = {};
  this.listensTo = {};
  this.heads = {};
}

Stream.prototype = {

  addNode: function _stream_addNode(obj, isHead) {
    if (!this.listensTo[obj.listenType]) {
      this.listensTo[obj.listenType] = [];
    }
    this.listensTo[obj.listenType].push(obj.identifier);

    this.objects[obj.identifier] = obj;

    if (isHead) {
      this.heads[obj.listenType] = true;
    }
  },

  push: function _stream_push(messageType, message) {
    /*
     * Push a message down the stream, from the top
     * @returns a promise that gets resolved when all downstream tasks are done
     */
    let deferred = Promise.defer();
    if (!(this.heads.hasOwnProperty(messageType) && this.listensTo.hasOwnProperty(messageType))) {
      deferred.reject("cannot push a non-head message");
    }
    let handlers = this.listensTo[messageType] || [];
    return this._launch_process(handlers, message);
  },

  flush: function _stream_flush() {
    /*
     * Push a message down the stream, from the top
     * @returns a promise that gets resolved when all downstream tasks are done
     */
    let handlers = [];
    for (let messageType in this.heads) {
      let msgHandlers = this.listensTo[messageType];
      for (let handlerName of msgHandlers) {
        handlers.push(handlerName);
      }
    }
    return this._launch_process(handlers, null, true);
  },

  _launch_process: function _stream__launch_process(handlers, message, flush) {
    /*
     * Kick off processing to the first listeners of a message.
     * Wait until all downstream processors are done to return.
     * @param handlers  an array of worker names to send the initial message
     * @param message   initial message to send to the network
     * @param flush     whether to send a flush message or not
     */
    let deferred = Promise.defer();
    let subTasks = [];
    for (let handlerName of handlers) {
      subTasks.push(this._process(handlerName, message, flush));
    }
    Promise.all(subTasks).then(() => {
      deferred.resolve();
    },
    error => {
      Cu.reportError(error);
      deferred.reject(error);
    });
    return deferred.promise;
  },

  _process: function _stream__process(objectIdent, message, flush) {
    /*
     * Process a task, starting a chain of messages, until there is no
     * more to do to process.
     * @param   objectIdent     object identifier to send a message
     * @param   message         message to be sent. ignored when flushing
     * @param   flush           trigger nodes to flush
     */
    let worker = this.objects[objectIdent];
    let messageCopy = JSON.parse(JSON.stringify(message));
    return worker.consume(messageCopy, flush).then(newMessage => {
      let listeners = this.listensTo[worker.emitType] || [];
      let promises = [];
      for (let ident of listeners) {
        promises.push(this._process(ident, newMessage));
      }
      return Promise.all(promises);
    });
  },
}

exports.Node = Node;
exports.createNode = createNode;
exports.Stream = Stream;