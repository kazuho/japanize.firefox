var JAPANIZE = {
    
    VERSION: "0.8.10",
    PROMPT_TITLE: "Japanize",
    UID: "kazuho-japanize2@labs.cybozu.co.jp",
    
    permManager: Components.classes["@mozilla.org/permissionmanager;1"].getService(Components.interfaces.nsIPermissionManager),
    
    getPromptService: function () {
        return Components.classes["@mozilla.org/embedcomp/prompt-service;1"]
            .getService(Components.interfaces.nsIPromptService);
    },
    
    notifyUser: function (message) {
        this.getPromptService().alert(window, this.PROMPT_TITLE, message);
    },
    
    openPermissions: function (host) {
        var params = {
            permissionType: "japanize",
            windowTitle:    "Japanize - 翻訳対象サイト",
            introText:      "Japanize による翻訳を許可する／許可しないサイトを指定することができます。設定するには、サイトのアドレスを入力してボタンをクリックしてください。",
            allowVisible:   true,
            sessionVisible: false,
            blockVisible:   true,
            prefilledHost:  host ? host : ""
        };
        var wm = Components.classes["@mozilla.org/appshell/window-mediator;1"]
            .getService(Components.interfaces.nsIWindowMediator);
        var existing = wm.getMostRecentWindow("Browser:Permissions");
        if (existing) {
            existing.initWithParams(params);
            existing.focus();
        } else {
            window.openDialog(
                "chrome://browser/content/preferences/permissions.xul",
                "_blank",
                "resizable,dialog=no,centerscreen",
                params);
        }
    },
    
    getStoreDir: function () {
        try {
            var profileDir =
                Components.classes["@mozilla.org/file/directory_service;1"]
                .getService(Components.interfaces.nsIProperties)
                .get("ProfD", Components.interfaces.nsILocalFile);
            // return the extension directory
            var dir = profileDir.clone();
            dir.append("extensions");
            if (dir.exists() && dir.isDirectory()) {
               dir.append(this.UID);
               if (dir.exists() && dir.isDirectory()) {
                   dir.append("data");
                   return dir;
               }
            }
            // if failed, create our own directory below profile dir
            dir = profileDir.clone();
            dir.append("japanize");
            if (! dir.exists()) {
                dir.create(Components.interfaces.nsIFile.DIRECTORY_TYPE, 0755);
            }
            return dir;
        } catch (e) {
            alert("Japanize: " + e.toString());
        }
    },
    
    saveToStore: function (file, text) {
        text = "\ufeff" + text.toString();
        
        var conv =
            Components.classes["@mozilla.org/intl/scriptableunicodeconverter"]
            .getService(Components.interfaces.nsIScriptableUnicodeConverter);
        conv.charset = "UTF-8";
        
        var temppath = this.getStoreDir();
        temppath.append("t" + Math.floor(Math.random() * 10000000) + ".tmp");
        
        var os = Components.classes["@mozilla.org/network/file-output-stream;1"]
            .createInstance(Components.interfaces.nsIFileOutputStream);
        os.init(temppath, 0x2a, 0644, -1);
        for (var offset = 0; offset < text.length; offset += 1024) {
            var data =
                String.fromCharCode.apply(
                    null,
                    conv.convertToByteArray(
                        text.substring(offset, offset + 1024),
                        new Number(0)));
            os.write(data, data.length);
        }
        os.close();
        
        try {
            temppath.moveTo(this.getStoreDir(), file);
        } catch (e) {
            try {
                temppath.remove(false);
            } catch (e2) {
            }
            throw e;
        }
    },
    
    getStoreURI: function (file) {
        var path = this.getStoreDir();
        path.append(file);
        return Components.classes["@mozilla.org/network/io-service;1"]
            .getService(Components.interfaces.nsIIOService)
            .newFileURI(path);
    },

    removeFromStore: function (file) {
        try {
            var path = this.getStoreDir();
            path.append(file);
            path.remove(false);
        } catch (e) {
            alert(e);
        }
    },

    getPreferenceService: function () {
        return Components.classes["@mozilla.org/preferences-service;1"]
            .getService(Components.interfaces.nsIPrefService)
                .getBranch("");
    },

    getPreference: function (name, defaultValue) {
        var value = null;
        try {
            value =
                this.getPreferenceService().getCharPref(
                    "extensions.japanize." + name);
        } catch (e) {
        }
        if (value == null) {
            value = defaultValue;
        }
        return value;
    },
    
    setPreference: function (name, value) {
        this.getPreferenceService().setCharPref(
            "extensions.japanize." + name, value.toString());
    },
    
    debugAlert: function () {
        if (! this.getPreference(this.getPreference('debug', ''))) {
            return;
        }
        alert.apply(null, arguments);
    },
    
    PREF_UPDATEMODE: "updatemode",
    UPDATEMODE_PERIODICALLY: "periodically",
    UPDATEMODE_EVERYTIME: "everytime",
    
    getUpdateMode: function () {
        return this.getPreference(
            this.PREF_UPDATEMODE, this.UPDATEMODE_PERIODICALLY);
    },
    
    setUpdateMode: function (newMode) {
        this.setPreference(this.PREF_UPDATEMODE, newMode);
    },
    
    getBaseURL: function () {
        return this.getPreference("baseURL", "http://japanize.31tools.com/");
    },
    
    normalizeHost: function (host) {
        return host.toString().toLowerCase().replace(/\.$/, "");
    },
    
    buildTranslationURL: function (host) {
        var url =
            this.getBaseURL() + "data/" + this.normalizeHost(host)
            + "/current.txt";
        return url;
    },
    
    isMarkedURL: function (url, allowed) {
        var perm = this.permManager.testPermission(
            Components.classes["@mozilla.org/network/io-service;1"]
	        .getService(Components.interfaces.nsIIOService)
                    .newURI(url.toString(), null, null),
	    "japanize");
        return perm == Components.interfaces.nsIPermissionManager[
            allowed ? 'ALLOW_ACTION' : 'DENY_ACTION'];
    },
    
    loadLocalizationData: function (doc) {
        doc.__JAPANIZED = true;
        var browser = this.findBrowser(doc);
        if (doc.location.protocol != "http:") {
            this.updateStatus(browser, "");
            return;
        }
        if (this.getMode()
                ? this.isMarkedURL(doc.location, false)
                    : ! this.isMarkedURL(doc.location, true)) {
            this.updateStatus(browser, "");
            return;
        }
        if (this.getUpdateMode() == this.UPDATEMODE_PERIODICALLY) {
            setTimeout(function () {
                           JAPANIZE.localizeWithLocalData(doc, browser);
                       },
                       1);
            return;
        }
        if (this.getUpdateMode() == this.UPDATEMODE_EVERYTIME) {
            try {
                var xhr = new XMLHttpRequest();
                xhr.open(
                    "get",
                    this.buildTranslationURL(doc.location.host),
                    true);
                xhr.onreadystatechange = function () {
                    if (xhr.readyState == 4) {
                        JAPANIZE.localizeWithData(
                            JAPANIZE.parseJSON(xhr.responseText),
                            doc,
                            browser);
                    }
                };
                xhr.send(null);
            } catch (e) {
                alert("Japanize: " + e.toString());
            }
        }
    },

    localizeWithLocalData: function (doc, browser) {
        var table;
        if (typeof this.localTranslatableDomains == 'object') {
            var domain = JAPANIZE.normalizeHost(doc.location.host);
            while (typeof this.localTranslatableDomains[domain] == 'undefined') {
              if (! domain.match(/\./)) {
                domain = undefined;
                break;
              }
              domain = RegExp.rightContext;
            }
            if (typeof domain != 'undefined') {
                table = this.localTranslationTable[domain];
                if (typeof table == 'undefined') {
                    try {
                        var fname = ((domain.charAt(0) == '*') ? domain.substring(2) : domain) + ".txt";
                        //alert("fname " + fname);
                        var xhr = new XMLHttpRequest();
                        xhr.open("get",
                                 this.getStoreURI(fname).spec,
                                 true);
                        xhr.onreadystatechange = function () {
                            if (xhr.readyState == 4) {
                                var json = JAPANIZE.parseJSON(xhr.responseText);
                                JAPANIZE.localTranslationTable[domain] = json;
                                JAPANIZE.localizeWithData(json, doc, browser);
                            }
                        };
                        xhr.send(null);
                        return;
                    } catch (e) {
                        alert("Japanize: " + e.toString());
                    }
                }
            }
        }
        this.localizeWithData(table, doc, browser);
    },

    canTranslateHost: function (host) {
        var list = this.getPreference("hosts", "").split(",");
        if (list.length == 0) {
            return true;
        }
        for (var i = 0; i < list.length; i++) {
            var flag = list[i].charAt(0);
            var pat = list[i].substring(1).replace(
                /[^A-Za-z0-9\-]/g,
                function (m) {
                    return m == '*' ? '.*' : '\\' + m;
                });
            pat = new RegExp(pat);
            if (typeof pat != 'undefined' && host.match(new RegExp(pat))) {
                if (flag == '-') {
                    return false;
                } else if (flag == '+') {
                    return true;
                }
            }
        }
        return true;
    },
    
    localizeWithData: function (json, doc, browser) {
        this.updateStatus(browser, "");
        // do nothing unless translation is available
        if (typeof json != "object") {
            return;
        }
        // check preferences
        if (! this.canTranslateHost(doc.location.host)) {
            this.updateStatus(browser, "原文を表示");
            return;
        }
        // convert json to internal representation
        var mappings = {
            text: {},
            re: []
        };
        this.initCommandMappings(mappings);
        for (var n in json) {
            if (n.charAt(0) == '$') {
                this.compileCommand(mappings, n, json[n]);
            } else if (n.match(/^\/(\^.*\$)\/$/)) {
                var v = json[n];
                try {
                    n = new RegExp(RegExp.$1);
                } catch (e) {
                    this.debugAlert(
                        "正規表現「" + n + "」のコンパイルに失敗しました");
                    continue;
                }
                mappings.re.push([ n, v ]);
            } else {
                mappings.text[n] = json[n];
            }
        }
        this.postProcessCommandMappings(mappings);
        // check url patterns
        if (this.ifSkipURL(mappings, doc.location)) {
            this.updateStatus(browser, '翻訳しないページ');
            return;
        }
        // setup logger
        var log = ! ! this.getPreference("log", "");
        if (log && typeof FireBug == 'undefined' && ! JAPANIZE.noFireBugAlert) {
            alert("Japanize: 翻訳ログを取得するためには FireBug をインストールしてください");
            JAPANIZE.noFireBugAlert = true;
            log = false;
        }
        if (log) {
            log = function (s) {
                FireBug.console.log(s);
            };
            log.log = true;
        } else {
            log = function () {
            };
            log.log = false;
        }
        // convert
        log("Japanize: translating: " + doc.location);
        this.localizeElement(doc.body, mappings, true);
        this.updateStatus(browser, '翻訳済み');
        
        // build handler for handilng DHTML modifs.
        var handler = function (evt) {
            if (handler.underOperation) {
                return;
            }
            if (log.log) {
                var msg = (function (t) {
                    if (t.id) {
                        return "id='" + t.id + "'";
                    } else if (t.className) {
                        return "class='" + t.className + "'";
                    } else if (t.parentNode) {
                        return arguments.callee(t.parentNode);
                    } else if (t.nodeType == 9) {
                        return "no identifier at root";
                    } else {
                        return "not within document";
                    }
                }).call(null, evt.target);
                msg += (function (t) {
                    while (typeof t == 'object' && t.nodeType != 9) {
                        t = t.parentNode;
                    }
                    if (! t) {
                        return '';
                    }
                    return ", " + t.location;
                }).call(null, evt.target);
                log("Japanize: " + msg);
            }
            setTimeout(
                function () {
                    handler.underOperation = true;
                    JAPANIZE.localizeElement(
                        evt.target,
                        mappings,
                        JAPANIZE.getElementTranslationMode(
                            mappings, doc.body, evt.target.parentNode));
                    handler.underOperation = false;
                },
                1);
        };
        doc.addEventListener("DOMNodeInserted", handler, false);
        doc.addEventListener("DOMCharacterDataModified", handler, false);
        doc.addEventListener(
            "DOMAttrModified",
            function (evt) {
                if (evt.attrName == 'style') {
                    var iframes = evt.target.getElementsByTagName('iframe');
                    for (var i = 0; i < iframes.length; i++) {
                        var doc = iframes[i].contentDocument;
                        if (! doc.__JAPANIZED) {
                            JAPANIZE.loadLocalizationData(doc);
                        }
                    }
                } else if (evt.target.tagName == 'INPUT'
                    || evt.target.tagName == 'OPTION') {
                    handler(evt);
                }
            },
            false);
    },
    
    translateText: function (orig, mappings) {
        // direct match
        if (typeof mappings.text[orig] != 'undefined') {
            return mappings.text[orig];
        }
        // match (while taking care of surrounding spaces)
        if (orig.match(/^([ \r\n\t\xa0]*)(.+?)([ \r\n\t\xa0]*)$/)
            && (RegExp.$1 != '' || RegExp.$3 != '')) {
            if (typeof mappings.text[RegExp.$2] != 'undefined') {
                return RegExp.$1 + mappings.text[RegExp.$2] + RegExp.$3;
            }
        }
        // regexp
        for (var i = 0; i < mappings.re.length; i++) {
            if (orig.match(mappings.re[i][0])) {
                var m = [];
                m[1] = RegExp.$1;
                m[2] = RegExp.$2;
                m[3] = RegExp.$3;
                m[4] = RegExp.$4;
                m[5] = RegExp.$5;
                m[6] = RegExp.$6;
                m[7] = RegExp.$7;
                m[8] = RegExp.$8;
                m[9] = RegExp.$9;
                return mappings.re[i][1].replace(
                    /\$(R?)([1-9])/g,
                    function (_dummy, rerun, digit) {
                        var t = m[digit - 0];
                        if (rerun) {
                            var t2 =
                                JAPANIZE.translateText(t, mappings);
                            if (t2 != null) {
                                t = t2;
                            }
                        }
                        return t;
                    });
            }
        }
        return null;
    },
    
    initCommandMappings: function (mappings) {
        var f0 = function () {
            return {
                 re: [],
                 reCaseless: [],
                 text: {}
            }
        };
        var f1 = function () {
            return {
                'class': f0(),
                id:      f0(),
                path:    f0(),
                tag:     f0(),
                url:     f0()
            };
        };
        mappings.skip = f1();
        mappings.translate = f1();
    },
    
    postProcessCommandMappings: function (mappings) {
        var f0 = function (t, n, f) {
            t[n] = t[n].length != 0 ? new RegExp(t[n].join('|'), f) : undefined;
        };
        var f1 = function (t) {
            f0(t, 're', '');
            f0(t, 'reCaseless', 'i');
        };
        var f2 = function (t) {
            f1(t['class']);
            f1(t.id);
            f1(t.path);
            f1(t.tag);
            f1(t.url);
        };
        f2(mappings.skip);
        f2(mappings.translate);
    },
    
    compileCommand: function (mappings, name, value) {
        if (! name.match(/^\$(.*?)\(\s*(~{0,2})\s*(.*)\s*\)$/)) {
            return;
        }
        var type = RegExp.$1;
        var re = RegExp.$2 ? RegExp.$2.length : 0;
        var match = RegExp.$3;
        var store = mappings
            [value[0] == 'skip' || value[0] == '' ? 'skip' : 'translate']
            [type];
        if (typeof store != 'object') {
            return;
        }
        if (re) {
            if (! new RegExp(match, re == 2 ? 'i' : '')) {
                this.debugAlert('シンタックスエラー: ' + name);
                return;
            }
            store[re == 2 ? 'reCaseless' : 're'].push(match);
        } else {
            if (type == 'tag') {
                match = match.toUpperCase();
            }
            store.text[match] = 1;
        }
    },
    
    ifSkipURL: function (mappings, loc) {
        return this.translateOrSkip(mappings.skip.path, loc.pathname)
            || this.translateOrSkip(mappings.skip.url, loc.toString());
    },
    
    translateOrSkipElement: function (mappings, e, current) {
        var table = mappings[current ? 'skip' : 'translate'];
        if (this.translateOrSkip(table.tag, e.tagName)
            || e.className && this.translateOrSkip(table['class'], e.className)
            || e.id && this.translateOrSkip(table.id, e.id)) {
            return ! current;
        }
        return current;
    },
    
    translateOrSkip: function (table, value) {
        value = value.toString();
        return typeof table.text[value] != 'undefined'
            || (table.re && value.match(table.re))
            || (table.reCaseless && value.match(table.reCaseless));
    },
    
    getElementTranslationMode: function (mappings, body, element) {
        var path = [];
        for (var p = (element.nodeType == 1 ? element : element.parentNode);
             p != body;
             p = p.parentNode) {
           path.push(p);
        }
        var translate = true;
        while (path.length != 0) {
            translate =
                this.translateOrSkipElement(mappings, path.pop(), translate);
        }
        return translate;
    },
    
    localizeElement: function (node, mappings, translate) {
        if (node.nodeType == 1) {
            translate = this.translateOrSkipElement(mappings, node, translate);
            if (node.nodeName == "SCRIPT" || node.nodeName == "STYLE") {
                // nothing to do
                return;
            } else if (node.nodeName == "INPUT") {
                if (! translate) {
                    return;
                }
                if (node.type == "button" || node.type == "reset") {
                    var translated = this.translateText(node.value, mappings);
                    if (translated != null) {
                        node.value = translated;
                    }
                }
                return;
            } else if (node.nodeName == "OPTION") {
                if (! translate) {
                    return;
                }
                var translated = this.translateText(node.text, mappings);
                if (translated != null) {
                    node.value = node.value.toString();
                    node.text = translated;
                }
                return;
            }
            var children = node.childNodes;
            for (var i = 0; i < children.length; i++) {
                this.localizeElement(children.item(i), mappings, translate);
            }
        } else if (translate && node.nodeType == 3) {
            var translated =
                this.translateText(node.nodeValue, mappings);
            if (translated != null) {
                node.nodeValue = translated;
            }
        }
    },
    
    parseJSON: function (text) {
        var json = undefined;
        try {
            var s = Components.utils.Sandbox(
                "http://sandbox.japanize.31tools.com/");
            Components.utils.evalInSandbox("json = " + text, s);
            json = s.json;
        } catch (e) {
            this.debugAlert(e);
        }
        return json;
    },
    
    findBrowser: function (doc) {
        var tb = getBrowser();
        for (var i = 0; i < tb.browsers.length; ++i) {
            var b = tb.getBrowserAtIndex(i);
            if (b.contentDocument == doc) {
                return b;
            }
        }
        return null;
    },
    
    updateStatus: function (browser, text) {
        if (browser == null) return;
        browser.contentDocument.JAPANIZED_status = text;
        this.redrawStatus();
    },
    
    redrawStatus: function () {
        var status =
            getBrowser().selectedBrowser.contentDocument.JAPANIZED_status;
        if (typeof status == "undefined") {
             status = "";
        }
        var label = document.getElementById("japanize-status-label");
        if (status == "") {
            label.style.display = "none";
        } else {
            label.value = status;
            label.style.display = "inline";
        }
    },
    
    getMode: function () {
        var img = document.getElementById("japanize-status-icon");
        return ! ! img.src.toString().match(/icon_on(_message)?\.gif$/);
    },
    
    setMode: function (on) {
        // setup icon
        var img = document.getElementById("japanize-status-icon");
        var url = img.src.toString();
        var main;
        if (on) {
            url = url.replace(/icon_off/, "icon_on");
            main = "Japanize: オン";
        } else {
            url = url.replace(/icon_on/, "icon_off");
            main = "Japanize: オフ";
        }
        img.src = url;
        document.getElementById("japanize-status-main").value = main;
    },
    
    getMenuItem: function (suffix) {
        return document.getElementById("japanize-popup-" + suffix);
    },
    
    showPopup: function (evt) {
        this.getMenuItem("enabled").setAttribute(
            "checked", this.getMode().toString());
        if (this.getUpdateMode() == this.UPDATEMODE_EVERYTIME) {
            this.getMenuItem("updateeverytime").setAttribute(
                "checked", "true");
            this.getMenuItem("updateperiodically").setAttribute(
                "checked", "false");
            this.getMenuItem("updatenow").setAttribute(
                "disabled", "true");
        } else {
            this.getMenuItem("updateeverytime").setAttribute(
                "checked", "false");
            this.getMenuItem("updateperiodically").setAttribute(
                "checked", "true");
            this.getMenuItem("updatenow").setAttribute(
                "disabled", "false");
        }
        if (typeof this.spinnerAnimator != 'undefined') {
            this.getMenuItem("updatenow").setAttribute(
                "disabled", "true");
        }
    },
    
    handlePopup: function (evt) {
        if (! evt.target.id.toString().match(/^japanize-popup-/)) {
            return;
        }
        var cmd = RegExp.rightContext;
        if (cmd == "enabled") {
            this.setMode(! this.getMode());
        } else if (cmd == "sites") {
            var url = getBrowser().selectedBrowser.contentDocument.location
                .toString();
            this.openPermissions(
                url.match(/^http:\/\/(.*?)(?:\/|$)/) ? RegExp.$1 : '');
        } else if (cmd == "updateeverytime") {
            this.setUpdateMode(this.UPDATEMODE_EVERYTIME);
        } else if (cmd == "updateperiodically") {
            this.setUpdateMode(this.UPDATEMODE_PERIODICALLY);
            if (this.needsUpdate()) {
                if (this.getPromptService().confirm(
                        window,
                        this.PROMPT_TITLE,
                        "翻訳データが古い可能性があります。ただちに更新しますか？")) {
                    this.downloadAllTable(true,evt.target);
                }
            }
        } else if (cmd == "updatenow") {
            this.downloadAllTable(true,evt.target);
        }
    },
    
    saveAllTable: function (content, buildDate, retryCount, notifyUser) {
        try {
            this.saveToStore("versions.txt", content);
            if (notifyUser) {
                JAPANIZE.notifyUser("翻訳データを更新しました");
            }
        } catch (e) {
            if (retryCount == 0) {
                JAPANIZE.notifyUser("翻訳データを保存できませんでした。しばらくしてから再操作してください\n\n" + e.toString());
            } else {
                setTimeout(
                    function () {
                        JAPANIZE.saveAllTable(
                            content, buildDate, retryCount - 1, notifyUser);
                    },
                    100);
            }
        }
    },
    
    downloadTranslationData: function (idx, domains, notifyUser) {
        var browser = getBrowser().selectedBrowser;
        if(idx >= domains.length){
            var l = JAPANIZE.newLocalTranslatableDomains;
            var versions_txt = "{\n";
            for(var k in l){
                versions_txt += "  \"" + k + "\":" + l[k] + ",\n";
            }
            versions_txt = versions_txt.substring(0,versions_txt.length - 2) + "\n}\n";
            this.stopSpinner();
            this.saveAllTable(versions_txt, l["$builddate"], 10, notifyUser);
            JAPANIZE.localTranslatableDomains = l;
        } else {
            try {
                this.setUpdateProgress(idx + "/" + domains.length);
                var domain = domains[idx];
                var xhr = new XMLHttpRequest();
                xhr.open("get",
                         JAPANIZE.buildTranslationURL(domain),
                         true);
                xhr.onreadystatechange = function () {
                    if (xhr.readyState == 4) {
                        if (typeof JAPANIZE.parseJSON(xhr.responseText) != 'object') {
                            if (notifyUser) {
                                JAPANIZE.notifyUser("翻訳データの更新に失敗しました。しばらくしてから再度操作してください。\n更新を実行するには、ステータスバーの日の丸アイコンを右クリックしてください。");
                            }
                            JAPANIZE.stopSpinner();
                            return;
                        }
                        var fname = domain + ".txt";
                        JAPANIZE.saveToStore(fname, xhr.responseText);
                        JAPANIZE.downloadTranslationData(idx+1,domains,notifyUser);
                    }
                };
                xhr.send(null);
            } catch (e) {
                this.stopSpinner();
                alert("Japanize: " + e.toString());
            }
        }
    },

    updateSpinner: function() {
        var t = (Math.sin(new Date().getTime()*6.28/1000) + 1)/2;
        var img = document.getElementById("japanize-status-icon");
        if (img != null) {
            img.tooltip = "japanize-update-status-tooltip";
            img.style.opacity = t;
        }
    },

    stopSpinner: function() {
        if(typeof this.spinnerAnimator != 'undefined') {
            clearInterval(this.spinnerAnimator);
            this.spinnerAnimator = undefined;
        }
        var img = document.getElementById("japanize-status-icon");
        if (img != null) {
            img.style.opacity = 1;
            img.tooltip = "japanize-status-tooltip";
        }
        var browser = getBrowser().selectedBrowser;
    },

    setUpdateProgress: function(str){
        var tooltiptext = document.getElementById("japanize-update-status-main");
        if (tooltiptext != null) {
            tooltiptext.value = "Japanize: 更新中 " + str;
        }
    },

    downloadAllTable: function (notifyUser,doc) {
        try {
            var browser = getBrowser().selectedBrowser;
            var xhr = new XMLHttpRequest();
            xhr.open(
                "get",
                this.getBaseURL() + "alldata/versions.txt",
                true);
            xhr.onreadystatechange = function () {
                if (xhr.readyState == 4) {
                    JAPANIZE.setUpdateProgress("");
                    JAPANIZE.spinnerAnimator = setInterval(JAPANIZE.updateSpinner,100);
                    var json = JAPANIZE.parseJSON(xhr.responseText);
                    if (typeof json != "object" || typeof json["$builddate"] != "number") {
                        if (notifyUser) {
                            JAPANIZE.notifyUser("翻訳データの更新に失敗しました。しばらくしてから再度操作してください。\n更新を実行するには、ステータスバーの日の丸アイコンを右クリックしてください。");
                        }
                        JAPANIZE.stopSpinner();
                        return;
                    }
                    var l = JAPANIZE.localTranslatableDomains;
                    if (json["$builddate"] == l["$builddate"]) {
                        JAPANIZE.stopSpinner();
                        if (notifyUser) {
                            JAPANIZE.notifyUser("翻訳データは最新です");
                        }
                        return;
                    }
                    var modified = false;
                    for(var d in l){
                        var c = d.charAt(0);
                        if((c != '*') && (c != '$') &&
                           (typeof json[d] == 'undefined')){
                            JAPANIZE.removeFromStore(d + ".txt");
                            modified = true;
                        }
                    }
                    var domains = new Array(0);
                    for(var d in json){
                        var c = d.charAt(0);
                        if((c != '*') && (c != '$') &&
                           ((typeof l[d] == 'undefined') || (json[d] != l[d]))){
                            domains.push(d);
                            modified = true;
                        }
                    }
                    if (!modified) {
                        JAPANIZE.stopSpinner();
                        if (notifyUser) {
                            JAPANIZE.notifyUser("翻訳データは最新です");
                        }
                        return;
                    }
                    JAPANIZE.newLocalTranslatableDomains = json;
                    JAPANIZE.downloadTranslationData(0, domains, notifyUser);
                }
            };
            xhr.send(null);
        } catch (e) {
            this.stopSpinner();
            alert("Japanize : " + e.toString());
        }
    },
    
    needsUpdate: function () {
        // every 3 hours by default
        var interval = this.getPreference("updateinterval", 3 * 3600) * 1000;
        var lastUpdateAt = this.getPreference("lastupdateat", 0) * 1;
        if (new Date().getTime() < lastUpdateAt + interval) {
            return false;
        }
        return true;
    },
    
    periodicalTasks: function () {
        if (! this.needsUpdate()) {
            return;
        }
        this.setPreference("lastupdateat", new Date().getTime());
        
        // update alltable if in periodical mode
        if (this.getUpdateMode() == this.UPDATEMODE_PERIODICALLY) {
            this.downloadAllTable(false);
        }
    },

    postStartup: function () {
        // setup post-installation page
        if (! JAPANIZE.getPreference("postinstall-" + JAPANIZE.VERSION)) {
            JAPANIZE.setPreference("postinstall-" + JAPANIZE.VERSION, "1");
            getBrowser().selectedTab = getBrowser().addTab(
                "http://japanize.31tools.com/index.cgi/postinstall?type=firefox&version=" + JAPANIZE.VERSION);
        }
    },
    
    installPostStartup: function () {
	eval('delayedStartup = ' + delayedStartup.toString().replace(/(}\)?\s*)$/, "JAPANIZE.postStartup();$1") + ';');
        this.installPostStartup = function () {}; // disable myself
    }
};

(function () {
    
    // alter delayedStartup
    JAPANIZE.installPostStartup();
    
    // remove old translation data
    try {
        var path = JAPANIZE.getStoreDir();
        path.append("all.txt");
        path.remove(false);
    } catch (e) {
    }
    
    // setup invocation trigger for loadL10NData
    var ac = window.document.getElementById("appcontent");
    ac.addEventListener(
        "DOMContentLoaded",
        function (evt) {
            JAPANIZE.loadLocalizationData(evt.target);
            JAPANIZE.periodicalTasks();
        },
        false);
    
    // setup status update trigger
    getBrowser().addEventListener(
        "pagehide",
        function () {
            setTimeout(
                function () {
                    JAPANIZE.redrawStatus();
                },
                1);
        },
        false);
    getBrowser().addEventListener(
        "pageshow",
        function (e) {
            JAPANIZE.redrawStatus();
        },
        false);
    getBrowser().addEventListener(
        "select",
        function () {
            setTimeout(
                function() {
                    JAPANIZE.redrawStatus();
                },
                1);
        },
        false);

    try {
        var xhr = new XMLHttpRequest();
        xhr.open(
                 "get",
                 JAPANIZE.getStoreURI("versions.txt").spec,
                 true);
        xhr.onreadystatechange = function () {
            if (xhr.readyState == 4) {
                var json = JAPANIZE.parseJSON(xhr.responseText);
                JAPANIZE.localTranslatableDomains = json;
                JAPANIZE.localTranslationTable = {};

                JAPANIZE.periodicalTasks();
            }
        };
        xhr.send(null);
    } catch (e) {
        alert("Japanize: " + e.toString());
    }
}).call();
