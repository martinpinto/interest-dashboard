/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
  * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const timers = require("timers");
const {data} = require("self");
const {URL} = require("url");
const {PlacesInterestsUtils} = require("PlacesInterestsUtils");

const {Cc,Ci,Cm,Cr,Cu,components,ChromeWorker} = require("chrome");

Cm.QueryInterface(Ci.nsIComponentRegistrar);

Cu.import("resource://gre/modules/Services.jsm", this);
Cu.import("resource://gre/modules/Task.jsm");
Cu.import("resource://gre/modules/commonjs/sdk/core/promise.js");
Cu.import("resource://gre/modules/NetUtil.jsm");

const MS_PER_DAY = 86400000;

function HistoryReader() {
  this.stopped = false;
}

HistoryReader.prototype = {

  setupWorker: function() {
    let scriptLoader = Cc["@mozilla.org/moz/jssubscript-loader;1"].getService(Ci.mozIJSSubScriptLoader);
    scriptLoader.loadSubScript(data.url("models/edrules/domainRules.js"));
    scriptLoader.loadSubScript(data.url("models/edrules/textModel.js"));
    scriptLoader.loadSubScript(data.url("models/edrules/urlStopwords.js"));

    this._worker = new ChromeWorker(data.url("interests/interestsWorker.js"));
    this._worker.addEventListener("message", this, false);
    this._worker.addEventListener("error", this, false);

    this._callMatchingWorker({
      message: "bootstrap",
      workerNamespace: "edrules",
      interestsDataType: "dfr",
      interestsData: interestsData,
      interestsClassifierModel: interestsClassifierModel,
      interestsUrlStopwords: interestsUrlStopwords
    });
  },

  init: function() {
    this.setupWorker();
  },

  stop: function() {
    this.stopped = true;
  },

  resubmitHistory: function(options = {}) {
    let daysBack = options.daysBack || 120;
    let chunkSize = options.chunkSize || 1000;
    return this._resubmitRecentHistory(daysBack, chunkSize);
  },

  //////////////////////////////////////////////////////////////////////////////
  //// nsIDOMEventListener

  handleEvent: function(aEvent) {
    let eventType = aEvent.type;
    if (eventType == "message") {
      let msgData = aEvent.data;
      if (msgData.message == "InterestsForDocument") {
        this._handleInterestsResults(msgData);
      }
    }
    else if (eventType == "error") {
      //TODO:handle error
      Cu.reportError(aEvent.message);
    }
  },

  //////////////////////////////////////////////////////////////////////////////
  //// Helpers

  _callMatchingWorker: function I__callMatchingWorker(callObject) {
    this._worker.postMessage(callObject);
  },

  _handleInterestsResults: function I__handleInterestsResults(aData) {
      // generate "interest-visit-saved" event
    Task.spawn(function() {
      // tell the world we have added this interest
      Services.obs.notifyObservers({wrappedJSObject: aData},
                                   "interest-visit-saved",
                                   null);
      // and check if this is the last interest in the resubmit bunch
      if (aData.messageId == "resubmit") {
        // decerement url count and check if we have seen them all
        this._ResubmitRecentHistoryUrlCount--;
        if (this._ResubmitRecentHistoryUrlCount == 0) {
          // one chunked resubmission is finished - start another
          timers.setTimeout(() => {this._resubmitRecentHistoryChunk();},0);
        }
      }
    }.bind(this));
  },

  _resubmitRecentHistory: function I__resubmitRecentHistory(daysBack, chunkSize = 1000) {
      // check if history is in progress
      if (this._ResubmitRecentHistoryDeferred) {
        return this._ResubmitRecentHistoryDeferred.promise;
      }
      this._ResubmitRecentHistoryDeferred = Promise.defer();
      this._ResubmitRecentHistoryLargestId = 0;
      this._ResubmitRecentHistoryDaysBack = daysBack;
      this._ResubmitRecentHistoryChunkSize = chunkSize;
      // spawn a Task to resubmit history
      Task.spawn(function() {
        // run the first chunk of history resubmission
        yield this._resubmitRecentHistoryChunk();
      }.bind(this));  // end of Task.spawn
      return this._ResubmitRecentHistoryDeferred.promise;
  },

  _resubmitRecentHistoryChunk: function I__ResubmitRecentHistoryChunk() {
    // clear out url count
    this._ResubmitRecentHistoryUrlCount = 0;
    // read moz_places data and message it to the worker
    return PlacesInterestsUtils.getRecentHistory(this._ResubmitRecentHistoryDaysBack, item => {
      try {
        let uri = NetUtil.newURI(item.url);
        item["message"] = "getInterestsForDocument";
        item["host"] = this._getPlacesHostForURI(uri);
        item["path"] = uri["path"];
        item["tld"] = this._getBaseDomain(item["host"]);
        item["metaData"] = {};
        item["language"] = "en";
        item["messageId"] = "resubmit";
        item["visitDate"] = this._convertDateToDays(item["visitDate"]);
        this._callMatchingWorker(item);
        this._ResubmitRecentHistoryUrlCount++;
        // keep track of the largest Id for this resubmission chunk
        if (this._ResubmitRecentHistoryLargestId < item["id"]) {
          this._ResubmitRecentHistoryLargestId = item["id"];
        }
      }
      catch(ex) {
        console.log(ex + " ERRORR\n");
      }
    },
    {
      chunkSize: this._ResubmitRecentHistoryChunkSize,
      lastPlacesId: this._ResubmitRecentHistoryLargestId,
    }).then(() => {
       // check if _ResubmitRecentHistoryDeferred exists and url count == 0
       // then if the history returns nothing for the this query, we can resolve
       // the resubmit promise
       if (this._ResubmitRecentHistoryDeferred && this._ResubmitRecentHistoryUrlCount == 0) {
         this._resolveResubmitHistoryPromise();
       }
       // issue en event that history resubmission is done
      Services.obs.notifyObservers({wrappedJSObject: {}},
                                   "interest-history-submission-complete",
                                   null);
    }); // end of getRecentHistory
  },

  _resolveResubmitHistoryPromise: function I__resolveResubmitHistoryPromise() {
    if (this._ResubmitRecentHistoryDeferred != null) {
      this._ResubmitRecentHistoryDeferred.resolve();
      this._ResubmitRecentHistoryDeferred = null;
    }
  },
  _normalizeHostName: function I__normalizeHostName(host) {
     return host.replace(/^www\./, "");
  },

  _getPlacesHostForURI: function I__getPlacesHostForURI(uri) {
    try {
      return this._normalizeHostName(uri.host);
    }
    catch(ex) {}
    return "";
  },

  _getBaseDomain: function I__getBaseDomain(host) {
    try {
      return Services.eTLD.getBaseDomainFromHost(host);
    }
    catch (ex) {
      return "";
    }
  },

  _convertDateToDays: function IS__convertDateToDays(time=null) {
    // Default to today and truncate to an integer number of days
    return Math.floor((time || Date.now()) / MS_PER_DAY);
  },

}

exports.HistoryReader = HistoryReader;