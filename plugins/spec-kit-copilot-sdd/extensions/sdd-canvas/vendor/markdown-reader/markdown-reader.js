//#region \0rolldown/runtime.js
var e = Object.create, t = Object.defineProperty, n = Object.getOwnPropertyDescriptor, r = Object.getOwnPropertyNames, i = Object.getPrototypeOf, a = Object.prototype.hasOwnProperty, o = (e, t) => () => (t || (e((t = { exports: {} }).exports, t), e = null), t.exports), s = (e, n) => {
	let r = {};
	for (var i in e) t(r, i, {
		get: e[i],
		enumerable: !0
	});
	return n || t(r, Symbol.toStringTag, { value: "Module" }), r;
}, c = (e, i, o, s) => {
	if (i && typeof i == "object" || typeof i == "function") for (var c = r(i), l = 0, u = c.length, d; l < u; l++) d = c[l], !a.call(e, d) && d !== o && t(e, d, {
		get: ((e) => i[e]).bind(null, d),
		enumerable: !(s = n(i, d)) || s.enumerable
	});
	return e;
}, l = (n, r, a) => (a = n == null ? {} : e(i(n)), c(r || !n || !n.__esModule ? t(a, "default", {
	value: n,
	enumerable: !0
}) : a, n)), u = /* @__PURE__ */ o(((e) => {
	function t(e, t) {
		var n = e.length;
		e.push(t);
		a: for (; 0 < n;) {
			var r = n - 1 >>> 1, a = e[r];
			if (0 < i(a, t)) e[r] = t, e[n] = a, n = r;
			else break a;
		}
	}
	function n(e) {
		return e.length === 0 ? null : e[0];
	}
	function r(e) {
		if (e.length === 0) return null;
		var t = e[0], n = e.pop();
		if (n !== t) {
			e[0] = n;
			a: for (var r = 0, a = e.length, o = a >>> 1; r < o;) {
				var s = 2 * (r + 1) - 1, c = e[s], l = s + 1, u = e[l];
				if (0 > i(c, n)) l < a && 0 > i(u, c) ? (e[r] = u, e[l] = n, r = l) : (e[r] = c, e[s] = n, r = s);
				else if (l < a && 0 > i(u, n)) e[r] = u, e[l] = n, r = l;
				else break a;
			}
		}
		return t;
	}
	function i(e, t) {
		var n = e.sortIndex - t.sortIndex;
		return n === 0 ? e.id - t.id : n;
	}
	if (e.unstable_now = void 0, typeof performance == "object" && typeof performance.now == "function") {
		var a = performance;
		e.unstable_now = function() {
			return a.now();
		};
	} else {
		var o = Date, s = o.now();
		e.unstable_now = function() {
			return o.now() - s;
		};
	}
	var c = [], l = [], u = 1, d = null, f = 3, p = !1, m = !1, h = !1, g = !1, _ = typeof setTimeout == "function" ? setTimeout : null, v = typeof clearTimeout == "function" ? clearTimeout : null, y = typeof setImmediate < "u" ? setImmediate : null;
	function b(e) {
		for (var i = n(l); i !== null;) {
			if (i.callback === null) r(l);
			else if (i.startTime <= e) r(l), i.sortIndex = i.expirationTime, t(c, i);
			else break;
			i = n(l);
		}
	}
	function ee(e) {
		if (h = !1, b(e), !m) if (n(c) !== null) m = !0, x || (x = !0, T());
		else {
			var t = n(l);
			t !== null && ie(ee, t.startTime - e);
		}
	}
	var x = !1, S = -1, te = 5, C = -1;
	function w() {
		return g ? !0 : !(e.unstable_now() - C < te);
	}
	function ne() {
		if (g = !1, x) {
			var t = e.unstable_now();
			C = t;
			var i = !0;
			try {
				a: {
					m = !1, h && (h = !1, v(S), S = -1), p = !0;
					var a = f;
					try {
						b: {
							for (b(t), d = n(c); d !== null && !(d.expirationTime > t && w());) {
								var o = d.callback;
								if (typeof o == "function") {
									d.callback = null, f = d.priorityLevel;
									var s = o(d.expirationTime <= t);
									if (t = e.unstable_now(), typeof s == "function") {
										d.callback = s, b(t), i = !0;
										break b;
									}
									d === n(c) && r(c), b(t);
								} else r(c);
								d = n(c);
							}
							if (d !== null) i = !0;
							else {
								var u = n(l);
								u !== null && ie(ee, u.startTime - t), i = !1;
							}
						}
						break a;
					} finally {
						d = null, f = a, p = !1;
					}
					i = void 0;
				}
			} finally {
				i ? T() : x = !1;
			}
		}
	}
	var T;
	if (typeof y == "function") T = function() {
		y(ne);
	};
	else if (typeof MessageChannel < "u") {
		var E = new MessageChannel(), re = E.port2;
		E.port1.onmessage = ne, T = function() {
			re.postMessage(null);
		};
	} else T = function() {
		_(ne, 0);
	};
	function ie(t, n) {
		S = _(function() {
			t(e.unstable_now());
		}, n);
	}
	e.unstable_IdlePriority = 5, e.unstable_ImmediatePriority = 1, e.unstable_LowPriority = 4, e.unstable_NormalPriority = 3, e.unstable_Profiling = null, e.unstable_UserBlockingPriority = 2, e.unstable_cancelCallback = function(e) {
		e.callback = null;
	}, e.unstable_forceFrameRate = function(e) {
		0 > e || 125 < e ? console.error("forceFrameRate takes a positive int between 0 and 125, forcing frame rates higher than 125 fps is not supported") : te = 0 < e ? Math.floor(1e3 / e) : 5;
	}, e.unstable_getCurrentPriorityLevel = function() {
		return f;
	}, e.unstable_next = function(e) {
		switch (f) {
			case 1:
			case 2:
			case 3:
				var t = 3;
				break;
			default: t = f;
		}
		var n = f;
		f = t;
		try {
			return e();
		} finally {
			f = n;
		}
	}, e.unstable_requestPaint = function() {
		g = !0;
	}, e.unstable_runWithPriority = function(e, t) {
		switch (e) {
			case 1:
			case 2:
			case 3:
			case 4:
			case 5: break;
			default: e = 3;
		}
		var n = f;
		f = e;
		try {
			return t();
		} finally {
			f = n;
		}
	}, e.unstable_scheduleCallback = function(r, i, a) {
		var o = e.unstable_now();
		switch (typeof a == "object" && a ? (a = a.delay, a = typeof a == "number" && 0 < a ? o + a : o) : a = o, r) {
			case 1:
				var s = -1;
				break;
			case 2:
				s = 250;
				break;
			case 5:
				s = 1073741823;
				break;
			case 4:
				s = 1e4;
				break;
			default: s = 5e3;
		}
		return s = a + s, r = {
			id: u++,
			callback: i,
			priorityLevel: r,
			startTime: a,
			expirationTime: s,
			sortIndex: -1
		}, a > o ? (r.sortIndex = a, t(l, r), n(c) === null && r === n(l) && (h ? (v(S), S = -1) : h = !0, ie(ee, a - o))) : (r.sortIndex = s, t(c, r), m || p || (m = !0, x || (x = !0, T()))), r;
	}, e.unstable_shouldYield = w, e.unstable_wrapCallback = function(e) {
		var t = f;
		return function() {
			var n = f;
			f = t;
			try {
				return e.apply(this, arguments);
			} finally {
				f = n;
			}
		};
	};
})), d = /* @__PURE__ */ o(((e, t) => {
	t.exports = u();
})), f = /* @__PURE__ */ o(((e) => {
	var t = Symbol.for("react.transitional.element"), n = Symbol.for("react.portal"), r = Symbol.for("react.fragment"), i = Symbol.for("react.strict_mode"), a = Symbol.for("react.profiler"), o = Symbol.for("react.consumer"), s = Symbol.for("react.context"), c = Symbol.for("react.forward_ref"), l = Symbol.for("react.suspense"), u = Symbol.for("react.memo"), d = Symbol.for("react.lazy"), f = Symbol.iterator;
	function p(e) {
		return typeof e != "object" || !e ? null : (e = f && e[f] || e["@@iterator"], typeof e == "function" ? e : null);
	}
	var m = {
		isMounted: function() {
			return !1;
		},
		enqueueForceUpdate: function() {},
		enqueueReplaceState: function() {},
		enqueueSetState: function() {}
	}, h = Object.assign, g = {};
	function _(e, t, n) {
		this.props = e, this.context = t, this.refs = g, this.updater = n || m;
	}
	_.prototype.isReactComponent = {}, _.prototype.setState = function(e, t) {
		if (typeof e != "object" && typeof e != "function" && e != null) throw Error("takes an object of state variables to update or a function which returns an object of state variables.");
		this.updater.enqueueSetState(this, e, t, "setState");
	}, _.prototype.forceUpdate = function(e) {
		this.updater.enqueueForceUpdate(this, e, "forceUpdate");
	};
	function v() {}
	v.prototype = _.prototype;
	function y(e, t, n) {
		this.props = e, this.context = t, this.refs = g, this.updater = n || m;
	}
	var b = y.prototype = new v();
	b.constructor = y, h(b, _.prototype), b.isPureReactComponent = !0;
	var ee = Array.isArray, x = {
		H: null,
		A: null,
		T: null,
		S: null,
		V: null
	}, S = Object.prototype.hasOwnProperty;
	function te(e, n, r, i, a, o) {
		return r = o.ref, {
			$$typeof: t,
			type: e,
			key: n,
			ref: r === void 0 ? null : r,
			props: o
		};
	}
	function C(e, t) {
		return te(e.type, t, void 0, void 0, void 0, e.props);
	}
	function w(e) {
		return typeof e == "object" && !!e && e.$$typeof === t;
	}
	function ne(e) {
		var t = {
			"=": "=0",
			":": "=2"
		};
		return "$" + e.replace(/[=:]/g, function(e) {
			return t[e];
		});
	}
	var T = /\/+/g;
	function E(e, t) {
		return typeof e == "object" && e && e.key != null ? ne("" + e.key) : t.toString(36);
	}
	function re() {}
	function ie(e) {
		switch (e.status) {
			case "fulfilled": return e.value;
			case "rejected": throw e.reason;
			default: switch (typeof e.status == "string" ? e.then(re, re) : (e.status = "pending", e.then(function(t) {
				e.status === "pending" && (e.status = "fulfilled", e.value = t);
			}, function(t) {
				e.status === "pending" && (e.status = "rejected", e.reason = t);
			})), e.status) {
				case "fulfilled": return e.value;
				case "rejected": throw e.reason;
			}
		}
		throw e;
	}
	function D(e, r, i, a, o) {
		var s = typeof e;
		(s === "undefined" || s === "boolean") && (e = null);
		var c = !1;
		if (e === null) c = !0;
		else switch (s) {
			case "bigint":
			case "string":
			case "number":
				c = !0;
				break;
			case "object": switch (e.$$typeof) {
				case t:
				case n:
					c = !0;
					break;
				case d: return c = e._init, D(c(e._payload), r, i, a, o);
			}
		}
		if (c) return o = o(e), c = a === "" ? "." + E(e, 0) : a, ee(o) ? (i = "", c != null && (i = c.replace(T, "$&/") + "/"), D(o, r, i, "", function(e) {
			return e;
		})) : o != null && (w(o) && (o = C(o, i + (o.key == null || e && e.key === o.key ? "" : ("" + o.key).replace(T, "$&/") + "/") + c)), r.push(o)), 1;
		c = 0;
		var l = a === "" ? "." : a + ":";
		if (ee(e)) for (var u = 0; u < e.length; u++) a = e[u], s = l + E(a, u), c += D(a, r, i, s, o);
		else if (u = p(e), typeof u == "function") for (e = u.call(e), u = 0; !(a = e.next()).done;) a = a.value, s = l + E(a, u++), c += D(a, r, i, s, o);
		else if (s === "object") {
			if (typeof e.then == "function") return D(ie(e), r, i, a, o);
			throw r = String(e), Error("Objects are not valid as a React child (found: " + (r === "[object Object]" ? "object with keys {" + Object.keys(e).join(", ") + "}" : r) + "). If you meant to render a collection of children, use an array instead.");
		}
		return c;
	}
	function O(e, t, n) {
		if (e == null) return e;
		var r = [], i = 0;
		return D(e, r, "", "", function(e) {
			return t.call(n, e, i++);
		}), r;
	}
	function ae(e) {
		if (e._status === -1) {
			var t = e._result;
			t = t(), t.then(function(t) {
				(e._status === 0 || e._status === -1) && (e._status = 1, e._result = t);
			}, function(t) {
				(e._status === 0 || e._status === -1) && (e._status = 2, e._result = t);
			}), e._status === -1 && (e._status = 0, e._result = t);
		}
		if (e._status === 1) return e._result.default;
		throw e._result;
	}
	var k = typeof reportError == "function" ? reportError : function(e) {
		if (typeof window == "object" && typeof window.ErrorEvent == "function") {
			var t = new window.ErrorEvent("error", {
				bubbles: !0,
				cancelable: !0,
				message: typeof e == "object" && e && typeof e.message == "string" ? String(e.message) : String(e),
				error: e
			});
			if (!window.dispatchEvent(t)) return;
		} else if (typeof process == "object" && typeof process.emit == "function") {
			process.emit("uncaughtException", e);
			return;
		}
		console.error(e);
	};
	function A() {}
	e.Children = {
		map: O,
		forEach: function(e, t, n) {
			O(e, function() {
				t.apply(this, arguments);
			}, n);
		},
		count: function(e) {
			var t = 0;
			return O(e, function() {
				t++;
			}), t;
		},
		toArray: function(e) {
			return O(e, function(e) {
				return e;
			}) || [];
		},
		only: function(e) {
			if (!w(e)) throw Error("React.Children.only expected to receive a single React element child.");
			return e;
		}
	}, e.Component = _, e.Fragment = r, e.Profiler = a, e.PureComponent = y, e.StrictMode = i, e.Suspense = l, e.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE = x, e.__COMPILER_RUNTIME = {
		__proto__: null,
		c: function(e) {
			return x.H.useMemoCache(e);
		}
	}, e.cache = function(e) {
		return function() {
			return e.apply(null, arguments);
		};
	}, e.cloneElement = function(e, t, n) {
		if (e == null) throw Error("The argument must be a React element, but you passed " + e + ".");
		var r = h({}, e.props), i = e.key, a = void 0;
		if (t != null) for (o in t.ref !== void 0 && (a = void 0), t.key !== void 0 && (i = "" + t.key), t) !S.call(t, o) || o === "key" || o === "__self" || o === "__source" || o === "ref" && t.ref === void 0 || (r[o] = t[o]);
		var o = arguments.length - 2;
		if (o === 1) r.children = n;
		else if (1 < o) {
			for (var s = Array(o), c = 0; c < o; c++) s[c] = arguments[c + 2];
			r.children = s;
		}
		return te(e.type, i, void 0, void 0, a, r);
	}, e.createContext = function(e) {
		return e = {
			$$typeof: s,
			_currentValue: e,
			_currentValue2: e,
			_threadCount: 0,
			Provider: null,
			Consumer: null
		}, e.Provider = e, e.Consumer = {
			$$typeof: o,
			_context: e
		}, e;
	}, e.createElement = function(e, t, n) {
		var r, i = {}, a = null;
		if (t != null) for (r in t.key !== void 0 && (a = "" + t.key), t) S.call(t, r) && r !== "key" && r !== "__self" && r !== "__source" && (i[r] = t[r]);
		var o = arguments.length - 2;
		if (o === 1) i.children = n;
		else if (1 < o) {
			for (var s = Array(o), c = 0; c < o; c++) s[c] = arguments[c + 2];
			i.children = s;
		}
		if (e && e.defaultProps) for (r in o = e.defaultProps, o) i[r] === void 0 && (i[r] = o[r]);
		return te(e, a, void 0, void 0, null, i);
	}, e.createRef = function() {
		return { current: null };
	}, e.forwardRef = function(e) {
		return {
			$$typeof: c,
			render: e
		};
	}, e.isValidElement = w, e.lazy = function(e) {
		return {
			$$typeof: d,
			_payload: {
				_status: -1,
				_result: e
			},
			_init: ae
		};
	}, e.memo = function(e, t) {
		return {
			$$typeof: u,
			type: e,
			compare: t === void 0 ? null : t
		};
	}, e.startTransition = function(e) {
		var t = x.T, n = {};
		x.T = n;
		try {
			var r = e(), i = x.S;
			i !== null && i(n, r), typeof r == "object" && r && typeof r.then == "function" && r.then(A, k);
		} catch (e) {
			k(e);
		} finally {
			x.T = t;
		}
	}, e.unstable_useCacheRefresh = function() {
		return x.H.useCacheRefresh();
	}, e.use = function(e) {
		return x.H.use(e);
	}, e.useActionState = function(e, t, n) {
		return x.H.useActionState(e, t, n);
	}, e.useCallback = function(e, t) {
		return x.H.useCallback(e, t);
	}, e.useContext = function(e) {
		return x.H.useContext(e);
	}, e.useDebugValue = function() {}, e.useDeferredValue = function(e, t) {
		return x.H.useDeferredValue(e, t);
	}, e.useEffect = function(e, t, n) {
		var r = x.H;
		if (typeof n == "function") throw Error("useEffect CRUD overload is not enabled in this build of React.");
		return r.useEffect(e, t);
	}, e.useId = function() {
		return x.H.useId();
	}, e.useImperativeHandle = function(e, t, n) {
		return x.H.useImperativeHandle(e, t, n);
	}, e.useInsertionEffect = function(e, t) {
		return x.H.useInsertionEffect(e, t);
	}, e.useLayoutEffect = function(e, t) {
		return x.H.useLayoutEffect(e, t);
	}, e.useMemo = function(e, t) {
		return x.H.useMemo(e, t);
	}, e.useOptimistic = function(e, t) {
		return x.H.useOptimistic(e, t);
	}, e.useReducer = function(e, t, n) {
		return x.H.useReducer(e, t, n);
	}, e.useRef = function(e) {
		return x.H.useRef(e);
	}, e.useState = function(e) {
		return x.H.useState(e);
	}, e.useSyncExternalStore = function(e, t, n) {
		return x.H.useSyncExternalStore(e, t, n);
	}, e.useTransition = function() {
		return x.H.useTransition();
	}, e.version = "19.1.1";
})), p = /* @__PURE__ */ o(((e, t) => {
	t.exports = f();
})), m = /* @__PURE__ */ o(((e) => {
	var t = p();
	function n(e) {
		var t = "https://react.dev/errors/" + e;
		if (1 < arguments.length) {
			t += "?args[]=" + encodeURIComponent(arguments[1]);
			for (var n = 2; n < arguments.length; n++) t += "&args[]=" + encodeURIComponent(arguments[n]);
		}
		return "Minified React error #" + e + "; visit " + t + " for the full message or use the non-minified dev environment for full errors and additional helpful warnings.";
	}
	function r() {}
	var i = {
		d: {
			f: r,
			r: function() {
				throw Error(n(522));
			},
			D: r,
			C: r,
			L: r,
			m: r,
			X: r,
			S: r,
			M: r
		},
		p: 0,
		findDOMNode: null
	}, a = Symbol.for("react.portal");
	function o(e, t, n) {
		var r = 3 < arguments.length && arguments[3] !== void 0 ? arguments[3] : null;
		return {
			$$typeof: a,
			key: r == null ? null : "" + r,
			children: e,
			containerInfo: t,
			implementation: n
		};
	}
	var s = t.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
	function c(e, t) {
		if (e === "font") return "";
		if (typeof t == "string") return t === "use-credentials" ? t : "";
	}
	e.__DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE = i, e.createPortal = function(e, t) {
		var r = 2 < arguments.length && arguments[2] !== void 0 ? arguments[2] : null;
		if (!t || t.nodeType !== 1 && t.nodeType !== 9 && t.nodeType !== 11) throw Error(n(299));
		return o(e, t, null, r);
	}, e.flushSync = function(e) {
		var t = s.T, n = i.p;
		try {
			if (s.T = null, i.p = 2, e) return e();
		} finally {
			s.T = t, i.p = n, i.d.f();
		}
	}, e.preconnect = function(e, t) {
		typeof e == "string" && (t ? (t = t.crossOrigin, t = typeof t == "string" ? t === "use-credentials" ? t : "" : void 0) : t = null, i.d.C(e, t));
	}, e.prefetchDNS = function(e) {
		typeof e == "string" && i.d.D(e);
	}, e.preinit = function(e, t) {
		if (typeof e == "string" && t && typeof t.as == "string") {
			var n = t.as, r = c(n, t.crossOrigin), a = typeof t.integrity == "string" ? t.integrity : void 0, o = typeof t.fetchPriority == "string" ? t.fetchPriority : void 0;
			n === "style" ? i.d.S(e, typeof t.precedence == "string" ? t.precedence : void 0, {
				crossOrigin: r,
				integrity: a,
				fetchPriority: o
			}) : n === "script" && i.d.X(e, {
				crossOrigin: r,
				integrity: a,
				fetchPriority: o,
				nonce: typeof t.nonce == "string" ? t.nonce : void 0
			});
		}
	}, e.preinitModule = function(e, t) {
		if (typeof e == "string") if (typeof t == "object" && t) {
			if (t.as == null || t.as === "script") {
				var n = c(t.as, t.crossOrigin);
				i.d.M(e, {
					crossOrigin: n,
					integrity: typeof t.integrity == "string" ? t.integrity : void 0,
					nonce: typeof t.nonce == "string" ? t.nonce : void 0
				});
			}
		} else t ?? i.d.M(e);
	}, e.preload = function(e, t) {
		if (typeof e == "string" && typeof t == "object" && t && typeof t.as == "string") {
			var n = t.as, r = c(n, t.crossOrigin);
			i.d.L(e, n, {
				crossOrigin: r,
				integrity: typeof t.integrity == "string" ? t.integrity : void 0,
				nonce: typeof t.nonce == "string" ? t.nonce : void 0,
				type: typeof t.type == "string" ? t.type : void 0,
				fetchPriority: typeof t.fetchPriority == "string" ? t.fetchPriority : void 0,
				referrerPolicy: typeof t.referrerPolicy == "string" ? t.referrerPolicy : void 0,
				imageSrcSet: typeof t.imageSrcSet == "string" ? t.imageSrcSet : void 0,
				imageSizes: typeof t.imageSizes == "string" ? t.imageSizes : void 0,
				media: typeof t.media == "string" ? t.media : void 0
			});
		}
	}, e.preloadModule = function(e, t) {
		if (typeof e == "string") if (t) {
			var n = c(t.as, t.crossOrigin);
			i.d.m(e, {
				as: typeof t.as == "string" && t.as !== "script" ? t.as : void 0,
				crossOrigin: n,
				integrity: typeof t.integrity == "string" ? t.integrity : void 0
			});
		} else i.d.m(e);
	}, e.requestFormReset = function(e) {
		i.d.r(e);
	}, e.unstable_batchedUpdates = function(e, t) {
		return e(t);
	}, e.useFormState = function(e, t, n) {
		return s.H.useFormState(e, t, n);
	}, e.useFormStatus = function() {
		return s.H.useHostTransitionStatus();
	}, e.version = "19.1.1";
})), h = /* @__PURE__ */ o(((e, t) => {
	function n() {
		if (!(typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ > "u" || typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE != "function")) try {
			__REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE(n);
		} catch (e) {
			console.error(e);
		}
	}
	n(), t.exports = m();
})), g = /* @__PURE__ */ o(((e) => {
	var t = d(), n = p(), r = h();
	function i(e) {
		var t = "https://react.dev/errors/" + e;
		if (1 < arguments.length) {
			t += "?args[]=" + encodeURIComponent(arguments[1]);
			for (var n = 2; n < arguments.length; n++) t += "&args[]=" + encodeURIComponent(arguments[n]);
		}
		return "Minified React error #" + e + "; visit " + t + " for the full message or use the non-minified dev environment for full errors and additional helpful warnings.";
	}
	function a(e) {
		return !(!e || e.nodeType !== 1 && e.nodeType !== 9 && e.nodeType !== 11);
	}
	function o(e) {
		var t = e, n = e;
		if (e.alternate) for (; t.return;) t = t.return;
		else {
			e = t;
			do
				t = e, t.flags & 4098 && (n = t.return), e = t.return;
			while (e);
		}
		return t.tag === 3 ? n : null;
	}
	function s(e) {
		if (e.tag === 13) {
			var t = e.memoizedState;
			if (t === null && (e = e.alternate, e !== null && (t = e.memoizedState)), t !== null) return t.dehydrated;
		}
		return null;
	}
	function c(e) {
		if (o(e) !== e) throw Error(i(188));
	}
	function l(e) {
		var t = e.alternate;
		if (!t) {
			if (t = o(e), t === null) throw Error(i(188));
			return t === e ? e : null;
		}
		for (var n = e, r = t;;) {
			var a = n.return;
			if (a === null) break;
			var s = a.alternate;
			if (s === null) {
				if (r = a.return, r !== null) {
					n = r;
					continue;
				}
				break;
			}
			if (a.child === s.child) {
				for (s = a.child; s;) {
					if (s === n) return c(a), e;
					if (s === r) return c(a), t;
					s = s.sibling;
				}
				throw Error(i(188));
			}
			if (n.return !== r.return) n = a, r = s;
			else {
				for (var l = !1, u = a.child; u;) {
					if (u === n) {
						l = !0, n = a, r = s;
						break;
					}
					if (u === r) {
						l = !0, r = a, n = s;
						break;
					}
					u = u.sibling;
				}
				if (!l) {
					for (u = s.child; u;) {
						if (u === n) {
							l = !0, n = s, r = a;
							break;
						}
						if (u === r) {
							l = !0, r = s, n = a;
							break;
						}
						u = u.sibling;
					}
					if (!l) throw Error(i(189));
				}
			}
			if (n.alternate !== r) throw Error(i(190));
		}
		if (n.tag !== 3) throw Error(i(188));
		return n.stateNode.current === n ? e : t;
	}
	function u(e) {
		var t = e.tag;
		if (t === 5 || t === 26 || t === 27 || t === 6) return e;
		for (e = e.child; e !== null;) {
			if (t = u(e), t !== null) return t;
			e = e.sibling;
		}
		return null;
	}
	var f = Object.assign, m = Symbol.for("react.element"), g = Symbol.for("react.transitional.element"), _ = Symbol.for("react.portal"), v = Symbol.for("react.fragment"), y = Symbol.for("react.strict_mode"), b = Symbol.for("react.profiler"), ee = Symbol.for("react.provider"), x = Symbol.for("react.consumer"), S = Symbol.for("react.context"), te = Symbol.for("react.forward_ref"), C = Symbol.for("react.suspense"), w = Symbol.for("react.suspense_list"), ne = Symbol.for("react.memo"), T = Symbol.for("react.lazy"), E = Symbol.for("react.activity"), re = Symbol.for("react.memo_cache_sentinel"), ie = Symbol.iterator;
	function D(e) {
		return typeof e != "object" || !e ? null : (e = ie && e[ie] || e["@@iterator"], typeof e == "function" ? e : null);
	}
	var O = Symbol.for("react.client.reference");
	function ae(e) {
		if (e == null) return null;
		if (typeof e == "function") return e.$$typeof === O ? null : e.displayName || e.name || null;
		if (typeof e == "string") return e;
		switch (e) {
			case v: return "Fragment";
			case b: return "Profiler";
			case y: return "StrictMode";
			case C: return "Suspense";
			case w: return "SuspenseList";
			case E: return "Activity";
		}
		if (typeof e == "object") switch (e.$$typeof) {
			case _: return "Portal";
			case S: return (e.displayName || "Context") + ".Provider";
			case x: return (e._context.displayName || "Context") + ".Consumer";
			case te:
				var t = e.render;
				return e = e.displayName, e ||= (e = t.displayName || t.name || "", e === "" ? "ForwardRef" : "ForwardRef(" + e + ")"), e;
			case ne: return t = e.displayName || null, t === null ? ae(e.type) || "Memo" : t;
			case T:
				t = e._payload, e = e._init;
				try {
					return ae(e(t));
				} catch {}
		}
		return null;
	}
	var k = Array.isArray, A = n.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE, j = r.__DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE, M = {
		pending: !1,
		data: null,
		method: null,
		action: null
	}, oe = [], se = -1;
	function ce(e) {
		return { current: e };
	}
	function le(e) {
		0 > se || (e.current = oe[se], oe[se] = null, se--);
	}
	function N(e, t) {
		se++, oe[se] = e.current, e.current = t;
	}
	var ue = ce(null), de = ce(null), fe = ce(null), pe = ce(null);
	function me(e, t) {
		switch (N(fe, t), N(de, e), N(ue, null), t.nodeType) {
			case 9:
			case 11:
				e = (e = t.documentElement) && (e = e.namespaceURI) ? Dd(e) : 0;
				break;
			default: if (e = t.tagName, t = t.namespaceURI) t = Dd(t), e = Od(t, e);
			else switch (e) {
				case "svg":
					e = 1;
					break;
				case "math":
					e = 2;
					break;
				default: e = 0;
			}
		}
		le(ue), N(ue, e);
	}
	function he() {
		le(ue), le(de), le(fe);
	}
	function ge(e) {
		e.memoizedState !== null && N(pe, e);
		var t = ue.current, n = Od(t, e.type);
		t !== n && (N(de, e), N(ue, n));
	}
	function _e(e) {
		de.current === e && (le(ue), le(de)), pe.current === e && (le(pe), Ff._currentValue = M);
	}
	var ve = Object.prototype.hasOwnProperty, ye = t.unstable_scheduleCallback, be = t.unstable_cancelCallback, xe = t.unstable_shouldYield, Se = t.unstable_requestPaint, Ce = t.unstable_now, we = t.unstable_getCurrentPriorityLevel, Te = t.unstable_ImmediatePriority, Ee = t.unstable_UserBlockingPriority, De = t.unstable_NormalPriority, Oe = t.unstable_LowPriority, ke = t.unstable_IdlePriority, Ae = t.log, je = t.unstable_setDisableYieldValue, Me = null, Ne = null;
	function Pe(e) {
		if (typeof Ae == "function" && je(e), Ne && typeof Ne.setStrictMode == "function") try {
			Ne.setStrictMode(Me, e);
		} catch {}
	}
	var Fe = Math.clz32 ? Math.clz32 : Re, Ie = Math.log, Le = Math.LN2;
	function Re(e) {
		return e >>>= 0, e === 0 ? 32 : 31 - (Ie(e) / Le | 0) | 0;
	}
	var ze = 256, Be = 4194304;
	function Ve(e) {
		var t = e & 42;
		if (t !== 0) return t;
		switch (e & -e) {
			case 1: return 1;
			case 2: return 2;
			case 4: return 4;
			case 8: return 8;
			case 16: return 16;
			case 32: return 32;
			case 64: return 64;
			case 128: return 128;
			case 256:
			case 512:
			case 1024:
			case 2048:
			case 4096:
			case 8192:
			case 16384:
			case 32768:
			case 65536:
			case 131072:
			case 262144:
			case 524288:
			case 1048576:
			case 2097152: return e & 4194048;
			case 4194304:
			case 8388608:
			case 16777216:
			case 33554432: return e & 62914560;
			case 67108864: return 67108864;
			case 134217728: return 134217728;
			case 268435456: return 268435456;
			case 536870912: return 536870912;
			case 1073741824: return 0;
			default: return e;
		}
	}
	function He(e, t, n) {
		var r = e.pendingLanes;
		if (r === 0) return 0;
		var i = 0, a = e.suspendedLanes, o = e.pingedLanes;
		e = e.warmLanes;
		var s = r & 134217727;
		return s === 0 ? (s = r & ~a, s === 0 ? o === 0 ? n || (n = r & ~e, n !== 0 && (i = Ve(n))) : i = Ve(o) : i = Ve(s)) : (r = s & ~a, r === 0 ? (o &= s, o === 0 ? n || (n = s & ~e, n !== 0 && (i = Ve(n))) : i = Ve(o)) : i = Ve(r)), i === 0 ? 0 : t !== 0 && t !== i && (t & a) === 0 && (a = i & -i, n = t & -t, a >= n || a === 32 && n & 4194048) ? t : i;
	}
	function Ue(e, t) {
		return (e.pendingLanes & ~(e.suspendedLanes & ~e.pingedLanes) & t) === 0;
	}
	function We(e, t) {
		switch (e) {
			case 1:
			case 2:
			case 4:
			case 8:
			case 64: return t + 250;
			case 16:
			case 32:
			case 128:
			case 256:
			case 512:
			case 1024:
			case 2048:
			case 4096:
			case 8192:
			case 16384:
			case 32768:
			case 65536:
			case 131072:
			case 262144:
			case 524288:
			case 1048576:
			case 2097152: return t + 5e3;
			case 4194304:
			case 8388608:
			case 16777216:
			case 33554432: return -1;
			case 67108864:
			case 134217728:
			case 268435456:
			case 536870912:
			case 1073741824: return -1;
			default: return -1;
		}
	}
	function Ge() {
		var e = ze;
		return ze <<= 1, !(ze & 4194048) && (ze = 256), e;
	}
	function Ke() {
		var e = Be;
		return Be <<= 1, !(Be & 62914560) && (Be = 4194304), e;
	}
	function qe(e) {
		for (var t = [], n = 0; 31 > n; n++) t.push(e);
		return t;
	}
	function Je(e, t) {
		e.pendingLanes |= t, t !== 268435456 && (e.suspendedLanes = 0, e.pingedLanes = 0, e.warmLanes = 0);
	}
	function Ye(e, t, n, r, i, a) {
		var o = e.pendingLanes;
		e.pendingLanes = n, e.suspendedLanes = 0, e.pingedLanes = 0, e.warmLanes = 0, e.expiredLanes &= n, e.entangledLanes &= n, e.errorRecoveryDisabledLanes &= n, e.shellSuspendCounter = 0;
		var s = e.entanglements, c = e.expirationTimes, l = e.hiddenUpdates;
		for (n = o & ~n; 0 < n;) {
			var u = 31 - Fe(n), d = 1 << u;
			s[u] = 0, c[u] = -1;
			var f = l[u];
			if (f !== null) for (l[u] = null, u = 0; u < f.length; u++) {
				var p = f[u];
				p !== null && (p.lane &= -536870913);
			}
			n &= ~d;
		}
		r !== 0 && Xe(e, r, 0), a !== 0 && i === 0 && e.tag !== 0 && (e.suspendedLanes |= a & ~(o & ~t));
	}
	function Xe(e, t, n) {
		e.pendingLanes |= t, e.suspendedLanes &= ~t;
		var r = 31 - Fe(t);
		e.entangledLanes |= t, e.entanglements[r] = e.entanglements[r] | 1073741824 | n & 4194090;
	}
	function Ze(e, t) {
		var n = e.entangledLanes |= t;
		for (e = e.entanglements; n;) {
			var r = 31 - Fe(n), i = 1 << r;
			i & t | e[r] & t && (e[r] |= t), n &= ~i;
		}
	}
	function Qe(e) {
		switch (e) {
			case 2:
				e = 1;
				break;
			case 8:
				e = 4;
				break;
			case 32:
				e = 16;
				break;
			case 256:
			case 512:
			case 1024:
			case 2048:
			case 4096:
			case 8192:
			case 16384:
			case 32768:
			case 65536:
			case 131072:
			case 262144:
			case 524288:
			case 1048576:
			case 2097152:
			case 4194304:
			case 8388608:
			case 16777216:
			case 33554432:
				e = 128;
				break;
			case 268435456:
				e = 134217728;
				break;
			default: e = 0;
		}
		return e;
	}
	function $e(e) {
		return e &= -e, 2 < e ? 8 < e ? e & 134217727 ? 32 : 268435456 : 8 : 2;
	}
	function et() {
		var e = j.p;
		return e === 0 ? (e = window.event, e === void 0 ? 32 : Xf(e.type)) : e;
	}
	function tt(e, t) {
		var n = j.p;
		try {
			return j.p = e, t();
		} finally {
			j.p = n;
		}
	}
	var nt = Math.random().toString(36).slice(2), rt = "__reactFiber$" + nt, it = "__reactProps$" + nt, at = "__reactContainer$" + nt, ot = "__reactEvents$" + nt, st = "__reactListeners$" + nt, ct = "__reactHandles$" + nt, lt = "__reactResources$" + nt, ut = "__reactMarker$" + nt;
	function dt(e) {
		delete e[rt], delete e[it], delete e[ot], delete e[st], delete e[ct];
	}
	function ft(e) {
		var t = e[rt];
		if (t) return t;
		for (var n = e.parentNode; n;) {
			if (t = n[at] || n[rt]) {
				if (n = t.alternate, t.child !== null || n !== null && n.child !== null) for (e = Kd(e); e !== null;) {
					if (n = e[rt]) return n;
					e = Kd(e);
				}
				return t;
			}
			e = n, n = e.parentNode;
		}
		return null;
	}
	function pt(e) {
		if (e = e[rt] || e[at]) {
			var t = e.tag;
			if (t === 5 || t === 6 || t === 13 || t === 26 || t === 27 || t === 3) return e;
		}
		return null;
	}
	function mt(e) {
		var t = e.tag;
		if (t === 5 || t === 26 || t === 27 || t === 6) return e.stateNode;
		throw Error(i(33));
	}
	function ht(e) {
		var t = e[lt];
		return t ||= e[lt] = {
			hoistableStyles: /* @__PURE__ */ new Map(),
			hoistableScripts: /* @__PURE__ */ new Map()
		}, t;
	}
	function gt(e) {
		e[ut] = !0;
	}
	var _t = /* @__PURE__ */ new Set(), vt = {};
	function yt(e, t) {
		bt(e, t), bt(e + "Capture", t);
	}
	function bt(e, t) {
		for (vt[e] = t, e = 0; e < t.length; e++) _t.add(t[e]);
	}
	var xt = RegExp("^[:A-Z_a-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF\\u200C-\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD][:A-Z_a-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF\\u200C-\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD\\-.0-9\\u00B7\\u0300-\\u036F\\u203F-\\u2040]*$"), St = {}, Ct = {};
	function wt(e) {
		return ve.call(Ct, e) ? !0 : ve.call(St, e) ? !1 : xt.test(e) ? Ct[e] = !0 : (St[e] = !0, !1);
	}
	function Tt(e, t, n) {
		if (wt(t)) if (n === null) e.removeAttribute(t);
		else {
			switch (typeof n) {
				case "undefined":
				case "function":
				case "symbol":
					e.removeAttribute(t);
					return;
				case "boolean":
					var r = t.toLowerCase().slice(0, 5);
					if (r !== "data-" && r !== "aria-") {
						e.removeAttribute(t);
						return;
					}
			}
			e.setAttribute(t, "" + n);
		}
	}
	function Et(e, t, n) {
		if (n === null) e.removeAttribute(t);
		else {
			switch (typeof n) {
				case "undefined":
				case "function":
				case "symbol":
				case "boolean":
					e.removeAttribute(t);
					return;
			}
			e.setAttribute(t, "" + n);
		}
	}
	function Dt(e, t, n, r) {
		if (r === null) e.removeAttribute(n);
		else {
			switch (typeof r) {
				case "undefined":
				case "function":
				case "symbol":
				case "boolean":
					e.removeAttribute(n);
					return;
			}
			e.setAttributeNS(t, n, "" + r);
		}
	}
	var Ot, kt;
	function At(e) {
		if (Ot === void 0) try {
			throw Error();
		} catch (e) {
			var t = e.stack.trim().match(/\n( *(at )?)/);
			Ot = t && t[1] || "", kt = -1 < e.stack.indexOf("\n    at") ? " (<anonymous>)" : -1 < e.stack.indexOf("@") ? "@unknown:0:0" : "";
		}
		return "\n" + Ot + e + kt;
	}
	var jt = !1;
	function Mt(e, t) {
		if (!e || jt) return "";
		jt = !0;
		var n = Error.prepareStackTrace;
		Error.prepareStackTrace = void 0;
		try {
			var r = { DetermineComponentFrameRoot: function() {
				try {
					if (t) {
						var n = function() {
							throw Error();
						};
						if (Object.defineProperty(n.prototype, "props", { set: function() {
							throw Error();
						} }), typeof Reflect == "object" && Reflect.construct) {
							try {
								Reflect.construct(n, []);
							} catch (e) {
								var r = e;
							}
							Reflect.construct(e, [], n);
						} else {
							try {
								n.call();
							} catch (e) {
								r = e;
							}
							e.call(n.prototype);
						}
					} else {
						try {
							throw Error();
						} catch (e) {
							r = e;
						}
						(n = e()) && typeof n.catch == "function" && n.catch(function() {});
					}
				} catch (e) {
					if (e && r && typeof e.stack == "string") return [e.stack, r.stack];
				}
				return [null, null];
			} };
			r.DetermineComponentFrameRoot.displayName = "DetermineComponentFrameRoot";
			var i = Object.getOwnPropertyDescriptor(r.DetermineComponentFrameRoot, "name");
			i && i.configurable && Object.defineProperty(r.DetermineComponentFrameRoot, "name", { value: "DetermineComponentFrameRoot" });
			var a = r.DetermineComponentFrameRoot(), o = a[0], s = a[1];
			if (o && s) {
				var c = o.split("\n"), l = s.split("\n");
				for (i = r = 0; r < c.length && !c[r].includes("DetermineComponentFrameRoot");) r++;
				for (; i < l.length && !l[i].includes("DetermineComponentFrameRoot");) i++;
				if (r === c.length || i === l.length) for (r = c.length - 1, i = l.length - 1; 1 <= r && 0 <= i && c[r] !== l[i];) i--;
				for (; 1 <= r && 0 <= i; r--, i--) if (c[r] !== l[i]) {
					if (r !== 1 || i !== 1) do
						if (r--, i--, 0 > i || c[r] !== l[i]) {
							var u = "\n" + c[r].replace(" at new ", " at ");
							return e.displayName && u.includes("<anonymous>") && (u = u.replace("<anonymous>", e.displayName)), u;
						}
					while (1 <= r && 0 <= i);
					break;
				}
			}
		} finally {
			jt = !1, Error.prepareStackTrace = n;
		}
		return (n = e ? e.displayName || e.name : "") ? At(n) : "";
	}
	function Nt(e) {
		switch (e.tag) {
			case 26:
			case 27:
			case 5: return At(e.type);
			case 16: return At("Lazy");
			case 13: return At("Suspense");
			case 19: return At("SuspenseList");
			case 0:
			case 15: return Mt(e.type, !1);
			case 11: return Mt(e.type.render, !1);
			case 1: return Mt(e.type, !0);
			case 31: return At("Activity");
			default: return "";
		}
	}
	function Pt(e) {
		try {
			var t = "";
			do
				t += Nt(e), e = e.return;
			while (e);
			return t;
		} catch (e) {
			return "\nError generating stack: " + e.message + "\n" + e.stack;
		}
	}
	function Ft(e) {
		switch (typeof e) {
			case "bigint":
			case "boolean":
			case "number":
			case "string":
			case "undefined": return e;
			case "object": return e;
			default: return "";
		}
	}
	function It(e) {
		var t = e.type;
		return (e = e.nodeName) && e.toLowerCase() === "input" && (t === "checkbox" || t === "radio");
	}
	function Lt(e) {
		var t = It(e) ? "checked" : "value", n = Object.getOwnPropertyDescriptor(e.constructor.prototype, t), r = "" + e[t];
		if (!e.hasOwnProperty(t) && n !== void 0 && typeof n.get == "function" && typeof n.set == "function") {
			var i = n.get, a = n.set;
			return Object.defineProperty(e, t, {
				configurable: !0,
				get: function() {
					return i.call(this);
				},
				set: function(e) {
					r = "" + e, a.call(this, e);
				}
			}), Object.defineProperty(e, t, { enumerable: n.enumerable }), {
				getValue: function() {
					return r;
				},
				setValue: function(e) {
					r = "" + e;
				},
				stopTracking: function() {
					e._valueTracker = null, delete e[t];
				}
			};
		}
	}
	function Rt(e) {
		e._valueTracker ||= Lt(e);
	}
	function zt(e) {
		if (!e) return !1;
		var t = e._valueTracker;
		if (!t) return !0;
		var n = t.getValue(), r = "";
		return e && (r = It(e) ? e.checked ? "true" : "false" : e.value), e = r, e === n ? !1 : (t.setValue(e), !0);
	}
	function P(e) {
		if (e ||= typeof document < "u" ? document : void 0, e === void 0) return null;
		try {
			return e.activeElement || e.body;
		} catch {
			return e.body;
		}
	}
	var F = /[\n"\\]/g;
	function I(e) {
		return e.replace(F, function(e) {
			return "\\" + e.charCodeAt(0).toString(16) + " ";
		});
	}
	function Bt(e, t, n, r, i, a, o, s) {
		e.name = "", o != null && typeof o != "function" && typeof o != "symbol" && typeof o != "boolean" ? e.type = o : e.removeAttribute("type"), t == null ? o !== "submit" && o !== "reset" || e.removeAttribute("value") : o === "number" ? (t === 0 && e.value === "" || e.value != t) && (e.value = "" + Ft(t)) : e.value !== "" + Ft(t) && (e.value = "" + Ft(t)), t == null ? n == null ? r != null && e.removeAttribute("value") : Ht(e, o, Ft(n)) : Ht(e, o, Ft(t)), i == null && a != null && (e.defaultChecked = !!a), i != null && (e.checked = i && typeof i != "function" && typeof i != "symbol"), s != null && typeof s != "function" && typeof s != "symbol" && typeof s != "boolean" ? e.name = "" + Ft(s) : e.removeAttribute("name");
	}
	function Vt(e, t, n, r, i, a, o, s) {
		if (a != null && typeof a != "function" && typeof a != "symbol" && typeof a != "boolean" && (e.type = a), t != null || n != null) {
			if (!(a !== "submit" && a !== "reset" || t != null)) return;
			n = n == null ? "" : "" + Ft(n), t = t == null ? n : "" + Ft(t), s || t === e.value || (e.value = t), e.defaultValue = t;
		}
		r ??= i, r = typeof r != "function" && typeof r != "symbol" && !!r, e.checked = s ? e.checked : !!r, e.defaultChecked = !!r, o != null && typeof o != "function" && typeof o != "symbol" && typeof o != "boolean" && (e.name = o);
	}
	function Ht(e, t, n) {
		t === "number" && P(e.ownerDocument) === e || e.defaultValue === "" + n || (e.defaultValue = "" + n);
	}
	function Ut(e, t, n, r) {
		if (e = e.options, t) {
			t = {};
			for (var i = 0; i < n.length; i++) t["$" + n[i]] = !0;
			for (n = 0; n < e.length; n++) i = t.hasOwnProperty("$" + e[n].value), e[n].selected !== i && (e[n].selected = i), i && r && (e[n].defaultSelected = !0);
		} else {
			for (n = "" + Ft(n), t = null, i = 0; i < e.length; i++) {
				if (e[i].value === n) {
					e[i].selected = !0, r && (e[i].defaultSelected = !0);
					return;
				}
				t !== null || e[i].disabled || (t = e[i]);
			}
			t !== null && (t.selected = !0);
		}
	}
	function L(e, t, n) {
		if (t != null && (t = "" + Ft(t), t !== e.value && (e.value = t), n == null)) {
			e.defaultValue !== t && (e.defaultValue = t);
			return;
		}
		e.defaultValue = n == null ? "" : "" + Ft(n);
	}
	function Wt(e, t, n, r) {
		if (t == null) {
			if (r != null) {
				if (n != null) throw Error(i(92));
				if (k(r)) {
					if (1 < r.length) throw Error(i(93));
					r = r[0];
				}
				n = r;
			}
			n ??= "", t = n;
		}
		n = Ft(t), e.defaultValue = n, r = e.textContent, r === n && r !== "" && r !== null && (e.value = r);
	}
	function Gt(e, t) {
		if (t) {
			var n = e.firstChild;
			if (n && n === e.lastChild && n.nodeType === 3) {
				n.nodeValue = t;
				return;
			}
		}
		e.textContent = t;
	}
	var Kt = new Set("animationIterationCount aspectRatio borderImageOutset borderImageSlice borderImageWidth boxFlex boxFlexGroup boxOrdinalGroup columnCount columns flex flexGrow flexPositive flexShrink flexNegative flexOrder gridArea gridRow gridRowEnd gridRowSpan gridRowStart gridColumn gridColumnEnd gridColumnSpan gridColumnStart fontWeight lineClamp lineHeight opacity order orphans scale tabSize widows zIndex zoom fillOpacity floodOpacity stopOpacity strokeDasharray strokeDashoffset strokeMiterlimit strokeOpacity strokeWidth MozAnimationIterationCount MozBoxFlex MozBoxFlexGroup MozLineClamp msAnimationIterationCount msFlex msZoom msFlexGrow msFlexNegative msFlexOrder msFlexPositive msFlexShrink msGridColumn msGridColumnSpan msGridRow msGridRowSpan WebkitAnimationIterationCount WebkitBoxFlex WebKitBoxFlexGroup WebkitBoxOrdinalGroup WebkitColumnCount WebkitColumns WebkitFlex WebkitFlexGrow WebkitFlexPositive WebkitFlexShrink WebkitLineClamp".split(" "));
	function qt(e, t, n) {
		var r = t.indexOf("--") === 0;
		n == null || typeof n == "boolean" || n === "" ? r ? e.setProperty(t, "") : t === "float" ? e.cssFloat = "" : e[t] = "" : r ? e.setProperty(t, n) : typeof n != "number" || n === 0 || Kt.has(t) ? t === "float" ? e.cssFloat = n : e[t] = ("" + n).trim() : e[t] = n + "px";
	}
	function Jt(e, t, n) {
		if (t != null && typeof t != "object") throw Error(i(62));
		if (e = e.style, n != null) {
			for (var r in n) !n.hasOwnProperty(r) || t != null && t.hasOwnProperty(r) || (r.indexOf("--") === 0 ? e.setProperty(r, "") : r === "float" ? e.cssFloat = "" : e[r] = "");
			for (var a in t) r = t[a], t.hasOwnProperty(a) && n[a] !== r && qt(e, a, r);
		} else for (var o in t) t.hasOwnProperty(o) && qt(e, o, t[o]);
	}
	function Yt(e) {
		if (e.indexOf("-") === -1) return !1;
		switch (e) {
			case "annotation-xml":
			case "color-profile":
			case "font-face":
			case "font-face-src":
			case "font-face-uri":
			case "font-face-format":
			case "font-face-name":
			case "missing-glyph": return !1;
			default: return !0;
		}
	}
	var Xt = new Map([
		["acceptCharset", "accept-charset"],
		["htmlFor", "for"],
		["httpEquiv", "http-equiv"],
		["crossOrigin", "crossorigin"],
		["accentHeight", "accent-height"],
		["alignmentBaseline", "alignment-baseline"],
		["arabicForm", "arabic-form"],
		["baselineShift", "baseline-shift"],
		["capHeight", "cap-height"],
		["clipPath", "clip-path"],
		["clipRule", "clip-rule"],
		["colorInterpolation", "color-interpolation"],
		["colorInterpolationFilters", "color-interpolation-filters"],
		["colorProfile", "color-profile"],
		["colorRendering", "color-rendering"],
		["dominantBaseline", "dominant-baseline"],
		["enableBackground", "enable-background"],
		["fillOpacity", "fill-opacity"],
		["fillRule", "fill-rule"],
		["floodColor", "flood-color"],
		["floodOpacity", "flood-opacity"],
		["fontFamily", "font-family"],
		["fontSize", "font-size"],
		["fontSizeAdjust", "font-size-adjust"],
		["fontStretch", "font-stretch"],
		["fontStyle", "font-style"],
		["fontVariant", "font-variant"],
		["fontWeight", "font-weight"],
		["glyphName", "glyph-name"],
		["glyphOrientationHorizontal", "glyph-orientation-horizontal"],
		["glyphOrientationVertical", "glyph-orientation-vertical"],
		["horizAdvX", "horiz-adv-x"],
		["horizOriginX", "horiz-origin-x"],
		["imageRendering", "image-rendering"],
		["letterSpacing", "letter-spacing"],
		["lightingColor", "lighting-color"],
		["markerEnd", "marker-end"],
		["markerMid", "marker-mid"],
		["markerStart", "marker-start"],
		["overlinePosition", "overline-position"],
		["overlineThickness", "overline-thickness"],
		["paintOrder", "paint-order"],
		["panose-1", "panose-1"],
		["pointerEvents", "pointer-events"],
		["renderingIntent", "rendering-intent"],
		["shapeRendering", "shape-rendering"],
		["stopColor", "stop-color"],
		["stopOpacity", "stop-opacity"],
		["strikethroughPosition", "strikethrough-position"],
		["strikethroughThickness", "strikethrough-thickness"],
		["strokeDasharray", "stroke-dasharray"],
		["strokeDashoffset", "stroke-dashoffset"],
		["strokeLinecap", "stroke-linecap"],
		["strokeLinejoin", "stroke-linejoin"],
		["strokeMiterlimit", "stroke-miterlimit"],
		["strokeOpacity", "stroke-opacity"],
		["strokeWidth", "stroke-width"],
		["textAnchor", "text-anchor"],
		["textDecoration", "text-decoration"],
		["textRendering", "text-rendering"],
		["transformOrigin", "transform-origin"],
		["underlinePosition", "underline-position"],
		["underlineThickness", "underline-thickness"],
		["unicodeBidi", "unicode-bidi"],
		["unicodeRange", "unicode-range"],
		["unitsPerEm", "units-per-em"],
		["vAlphabetic", "v-alphabetic"],
		["vHanging", "v-hanging"],
		["vIdeographic", "v-ideographic"],
		["vMathematical", "v-mathematical"],
		["vectorEffect", "vector-effect"],
		["vertAdvY", "vert-adv-y"],
		["vertOriginX", "vert-origin-x"],
		["vertOriginY", "vert-origin-y"],
		["wordSpacing", "word-spacing"],
		["writingMode", "writing-mode"],
		["xmlnsXlink", "xmlns:xlink"],
		["xHeight", "x-height"]
	]), Zt = /^[\u0000-\u001F ]*j[\r\n\t]*a[\r\n\t]*v[\r\n\t]*a[\r\n\t]*s[\r\n\t]*c[\r\n\t]*r[\r\n\t]*i[\r\n\t]*p[\r\n\t]*t[\r\n\t]*:/i;
	function Qt(e) {
		return Zt.test("" + e) ? "javascript:throw new Error('React has blocked a javascript: URL as a security precaution.')" : e;
	}
	var $t = null;
	function en(e) {
		return e = e.target || e.srcElement || window, e.correspondingUseElement && (e = e.correspondingUseElement), e.nodeType === 3 ? e.parentNode : e;
	}
	var tn = null, nn = null;
	function rn(e) {
		var t = pt(e);
		if (t && (e = t.stateNode)) {
			var n = e[it] || null;
			a: switch (e = t.stateNode, t.type) {
				case "input":
					if (Bt(e, n.value, n.defaultValue, n.defaultValue, n.checked, n.defaultChecked, n.type, n.name), t = n.name, n.type === "radio" && t != null) {
						for (n = e; n.parentNode;) n = n.parentNode;
						for (n = n.querySelectorAll("input[name=\"" + I("" + t) + "\"][type=\"radio\"]"), t = 0; t < n.length; t++) {
							var r = n[t];
							if (r !== e && r.form === e.form) {
								var a = r[it] || null;
								if (!a) throw Error(i(90));
								Bt(r, a.value, a.defaultValue, a.defaultValue, a.checked, a.defaultChecked, a.type, a.name);
							}
						}
						for (t = 0; t < n.length; t++) r = n[t], r.form === e.form && zt(r);
					}
					break a;
				case "textarea":
					L(e, n.value, n.defaultValue);
					break a;
				case "select": t = n.value, t != null && Ut(e, !!n.multiple, t, !1);
			}
		}
	}
	var an = !1;
	function on(e, t, n) {
		if (an) return e(t, n);
		an = !0;
		try {
			return e(t);
		} finally {
			if (an = !1, (tn !== null || nn !== null) && (cu(), tn && (t = tn, e = nn, nn = tn = null, rn(t), e))) for (t = 0; t < e.length; t++) rn(e[t]);
		}
	}
	function sn(e, t) {
		var n = e.stateNode;
		if (n === null) return null;
		var r = n[it] || null;
		if (r === null) return null;
		n = r[t];
		a: switch (t) {
			case "onClick":
			case "onClickCapture":
			case "onDoubleClick":
			case "onDoubleClickCapture":
			case "onMouseDown":
			case "onMouseDownCapture":
			case "onMouseMove":
			case "onMouseMoveCapture":
			case "onMouseUp":
			case "onMouseUpCapture":
			case "onMouseEnter":
				(r = !r.disabled) || (e = e.type, r = !(e === "button" || e === "input" || e === "select" || e === "textarea")), e = !r;
				break a;
			default: e = !1;
		}
		if (e) return null;
		if (n && typeof n != "function") throw Error(i(231, t, typeof n));
		return n;
	}
	var cn = !(typeof window > "u" || window.document === void 0 || window.document.createElement === void 0), ln = !1;
	if (cn) try {
		var un = {};
		Object.defineProperty(un, "passive", { get: function() {
			ln = !0;
		} }), window.addEventListener("test", un, un), window.removeEventListener("test", un, un);
	} catch {
		ln = !1;
	}
	var dn = null, fn = null, pn = null;
	function mn() {
		if (pn) return pn;
		var e, t = fn, n = t.length, r, i = "value" in dn ? dn.value : dn.textContent, a = i.length;
		for (e = 0; e < n && t[e] === i[e]; e++);
		var o = n - e;
		for (r = 1; r <= o && t[n - r] === i[a - r]; r++);
		return pn = i.slice(e, 1 < r ? 1 - r : void 0);
	}
	function hn(e) {
		var t = e.keyCode;
		return "charCode" in e ? (e = e.charCode, e === 0 && t === 13 && (e = 13)) : e = t, e === 10 && (e = 13), 32 <= e || e === 13 ? e : 0;
	}
	function gn() {
		return !0;
	}
	function _n() {
		return !1;
	}
	function vn(e) {
		function t(t, n, r, i, a) {
			for (var o in this._reactName = t, this._targetInst = r, this.type = n, this.nativeEvent = i, this.target = a, this.currentTarget = null, e) e.hasOwnProperty(o) && (t = e[o], this[o] = t ? t(i) : i[o]);
			return this.isDefaultPrevented = (i.defaultPrevented == null ? !1 === i.returnValue : i.defaultPrevented) ? gn : _n, this.isPropagationStopped = _n, this;
		}
		return f(t.prototype, {
			preventDefault: function() {
				this.defaultPrevented = !0;
				var e = this.nativeEvent;
				e && (e.preventDefault ? e.preventDefault() : typeof e.returnValue != "unknown" && (e.returnValue = !1), this.isDefaultPrevented = gn);
			},
			stopPropagation: function() {
				var e = this.nativeEvent;
				e && (e.stopPropagation ? e.stopPropagation() : typeof e.cancelBubble != "unknown" && (e.cancelBubble = !0), this.isPropagationStopped = gn);
			},
			persist: function() {},
			isPersistent: gn
		}), t;
	}
	var yn = {
		eventPhase: 0,
		bubbles: 0,
		cancelable: 0,
		timeStamp: function(e) {
			return e.timeStamp || Date.now();
		},
		defaultPrevented: 0,
		isTrusted: 0
	}, bn = vn(yn), xn = f({}, yn, {
		view: 0,
		detail: 0
	}), Sn = vn(xn), Cn, wn, Tn, En = f({}, xn, {
		screenX: 0,
		screenY: 0,
		clientX: 0,
		clientY: 0,
		pageX: 0,
		pageY: 0,
		ctrlKey: 0,
		shiftKey: 0,
		altKey: 0,
		metaKey: 0,
		getModifierState: Ln,
		button: 0,
		buttons: 0,
		relatedTarget: function(e) {
			return e.relatedTarget === void 0 ? e.fromElement === e.srcElement ? e.toElement : e.fromElement : e.relatedTarget;
		},
		movementX: function(e) {
			return "movementX" in e ? e.movementX : (e !== Tn && (Tn && e.type === "mousemove" ? (Cn = e.screenX - Tn.screenX, wn = e.screenY - Tn.screenY) : wn = Cn = 0, Tn = e), Cn);
		},
		movementY: function(e) {
			return "movementY" in e ? e.movementY : wn;
		}
	}), Dn = vn(En), On = vn(f({}, En, { dataTransfer: 0 })), kn = vn(f({}, xn, { relatedTarget: 0 })), An = vn(f({}, yn, {
		animationName: 0,
		elapsedTime: 0,
		pseudoElement: 0
	})), jn = vn(f({}, yn, { clipboardData: function(e) {
		return "clipboardData" in e ? e.clipboardData : window.clipboardData;
	} })), Mn = vn(f({}, yn, { data: 0 })), Nn = {
		Esc: "Escape",
		Spacebar: " ",
		Left: "ArrowLeft",
		Up: "ArrowUp",
		Right: "ArrowRight",
		Down: "ArrowDown",
		Del: "Delete",
		Win: "OS",
		Menu: "ContextMenu",
		Apps: "ContextMenu",
		Scroll: "ScrollLock",
		MozPrintableKey: "Unidentified"
	}, Pn = {
		8: "Backspace",
		9: "Tab",
		12: "Clear",
		13: "Enter",
		16: "Shift",
		17: "Control",
		18: "Alt",
		19: "Pause",
		20: "CapsLock",
		27: "Escape",
		32: " ",
		33: "PageUp",
		34: "PageDown",
		35: "End",
		36: "Home",
		37: "ArrowLeft",
		38: "ArrowUp",
		39: "ArrowRight",
		40: "ArrowDown",
		45: "Insert",
		46: "Delete",
		112: "F1",
		113: "F2",
		114: "F3",
		115: "F4",
		116: "F5",
		117: "F6",
		118: "F7",
		119: "F8",
		120: "F9",
		121: "F10",
		122: "F11",
		123: "F12",
		144: "NumLock",
		145: "ScrollLock",
		224: "Meta"
	}, Fn = {
		Alt: "altKey",
		Control: "ctrlKey",
		Meta: "metaKey",
		Shift: "shiftKey"
	};
	function In(e) {
		var t = this.nativeEvent;
		return t.getModifierState ? t.getModifierState(e) : (e = Fn[e]) ? !!t[e] : !1;
	}
	function Ln() {
		return In;
	}
	var Rn = vn(f({}, xn, {
		key: function(e) {
			if (e.key) {
				var t = Nn[e.key] || e.key;
				if (t !== "Unidentified") return t;
			}
			return e.type === "keypress" ? (e = hn(e), e === 13 ? "Enter" : String.fromCharCode(e)) : e.type === "keydown" || e.type === "keyup" ? Pn[e.keyCode] || "Unidentified" : "";
		},
		code: 0,
		location: 0,
		ctrlKey: 0,
		shiftKey: 0,
		altKey: 0,
		metaKey: 0,
		repeat: 0,
		locale: 0,
		getModifierState: Ln,
		charCode: function(e) {
			return e.type === "keypress" ? hn(e) : 0;
		},
		keyCode: function(e) {
			return e.type === "keydown" || e.type === "keyup" ? e.keyCode : 0;
		},
		which: function(e) {
			return e.type === "keypress" ? hn(e) : e.type === "keydown" || e.type === "keyup" ? e.keyCode : 0;
		}
	})), zn = vn(f({}, En, {
		pointerId: 0,
		width: 0,
		height: 0,
		pressure: 0,
		tangentialPressure: 0,
		tiltX: 0,
		tiltY: 0,
		twist: 0,
		pointerType: 0,
		isPrimary: 0
	})), Bn = vn(f({}, xn, {
		touches: 0,
		targetTouches: 0,
		changedTouches: 0,
		altKey: 0,
		metaKey: 0,
		ctrlKey: 0,
		shiftKey: 0,
		getModifierState: Ln
	})), Vn = vn(f({}, yn, {
		propertyName: 0,
		elapsedTime: 0,
		pseudoElement: 0
	})), Hn = vn(f({}, En, {
		deltaX: function(e) {
			return "deltaX" in e ? e.deltaX : "wheelDeltaX" in e ? -e.wheelDeltaX : 0;
		},
		deltaY: function(e) {
			return "deltaY" in e ? e.deltaY : "wheelDeltaY" in e ? -e.wheelDeltaY : "wheelDelta" in e ? -e.wheelDelta : 0;
		},
		deltaZ: 0,
		deltaMode: 0
	})), Un = vn(f({}, yn, {
		newState: 0,
		oldState: 0
	})), Wn = [
		9,
		13,
		27,
		32
	], Gn = cn && "CompositionEvent" in window, Kn = null;
	cn && "documentMode" in document && (Kn = document.documentMode);
	var qn = cn && "TextEvent" in window && !Kn, Jn = cn && (!Gn || Kn && 8 < Kn && 11 >= Kn), Yn = " ", Xn = !1;
	function Zn(e, t) {
		switch (e) {
			case "keyup": return Wn.indexOf(t.keyCode) !== -1;
			case "keydown": return t.keyCode !== 229;
			case "keypress":
			case "mousedown":
			case "focusout": return !0;
			default: return !1;
		}
	}
	function Qn(e) {
		return e = e.detail, typeof e == "object" && "data" in e ? e.data : null;
	}
	var $n = !1;
	function er(e, t) {
		switch (e) {
			case "compositionend": return Qn(t);
			case "keypress": return t.which === 32 ? (Xn = !0, Yn) : null;
			case "textInput": return e = t.data, e === Yn && Xn ? null : e;
			default: return null;
		}
	}
	function tr(e, t) {
		if ($n) return e === "compositionend" || !Gn && Zn(e, t) ? (e = mn(), pn = fn = dn = null, $n = !1, e) : null;
		switch (e) {
			case "paste": return null;
			case "keypress":
				if (!(t.ctrlKey || t.altKey || t.metaKey) || t.ctrlKey && t.altKey) {
					if (t.char && 1 < t.char.length) return t.char;
					if (t.which) return String.fromCharCode(t.which);
				}
				return null;
			case "compositionend": return Jn && t.locale !== "ko" ? null : t.data;
			default: return null;
		}
	}
	var nr = {
		color: !0,
		date: !0,
		datetime: !0,
		"datetime-local": !0,
		email: !0,
		month: !0,
		number: !0,
		password: !0,
		range: !0,
		search: !0,
		tel: !0,
		text: !0,
		time: !0,
		url: !0,
		week: !0
	};
	function rr(e) {
		var t = e && e.nodeName && e.nodeName.toLowerCase();
		return t === "input" ? !!nr[e.type] : t === "textarea";
	}
	function ir(e, t, n, r) {
		tn ? nn ? nn.push(r) : nn = [r] : tn = r, t = pd(t, "onChange"), 0 < t.length && (n = new bn("onChange", "change", null, n, r), e.push({
			event: n,
			listeners: t
		}));
	}
	var ar = null, or = null;
	function sr(e) {
		od(e, 0);
	}
	function cr(e) {
		if (zt(mt(e))) return e;
	}
	function lr(e, t) {
		if (e === "change") return t;
	}
	var ur = !1;
	if (cn) {
		var dr;
		if (cn) {
			var fr = "oninput" in document;
			if (!fr) {
				var pr = document.createElement("div");
				pr.setAttribute("oninput", "return;"), fr = typeof pr.oninput == "function";
			}
			dr = fr;
		} else dr = !1;
		ur = dr && (!document.documentMode || 9 < document.documentMode);
	}
	function mr() {
		ar && (ar.detachEvent("onpropertychange", hr), or = ar = null);
	}
	function hr(e) {
		if (e.propertyName === "value" && cr(or)) {
			var t = [];
			ir(t, or, e, en(e)), on(sr, t);
		}
	}
	function gr(e, t, n) {
		e === "focusin" ? (mr(), ar = t, or = n, ar.attachEvent("onpropertychange", hr)) : e === "focusout" && mr();
	}
	function _r(e) {
		if (e === "selectionchange" || e === "keyup" || e === "keydown") return cr(or);
	}
	function vr(e, t) {
		if (e === "click") return cr(t);
	}
	function yr(e, t) {
		if (e === "input" || e === "change") return cr(t);
	}
	function br(e, t) {
		return e === t && (e !== 0 || 1 / e == 1 / t) || e !== e && t !== t;
	}
	var xr = typeof Object.is == "function" ? Object.is : br;
	function Sr(e, t) {
		if (xr(e, t)) return !0;
		if (typeof e != "object" || !e || typeof t != "object" || !t) return !1;
		var n = Object.keys(e), r = Object.keys(t);
		if (n.length !== r.length) return !1;
		for (r = 0; r < n.length; r++) {
			var i = n[r];
			if (!ve.call(t, i) || !xr(e[i], t[i])) return !1;
		}
		return !0;
	}
	function Cr(e) {
		for (; e && e.firstChild;) e = e.firstChild;
		return e;
	}
	function wr(e, t) {
		var n = Cr(e);
		e = 0;
		for (var r; n;) {
			if (n.nodeType === 3) {
				if (r = e + n.textContent.length, e <= t && r >= t) return {
					node: n,
					offset: t - e
				};
				e = r;
			}
			a: {
				for (; n;) {
					if (n.nextSibling) {
						n = n.nextSibling;
						break a;
					}
					n = n.parentNode;
				}
				n = void 0;
			}
			n = Cr(n);
		}
	}
	function Tr(e, t) {
		return e && t ? e === t ? !0 : e && e.nodeType === 3 ? !1 : t && t.nodeType === 3 ? Tr(e, t.parentNode) : "contains" in e ? e.contains(t) : e.compareDocumentPosition ? !!(e.compareDocumentPosition(t) & 16) : !1 : !1;
	}
	function Er(e) {
		e = e != null && e.ownerDocument != null && e.ownerDocument.defaultView != null ? e.ownerDocument.defaultView : window;
		for (var t = P(e.document); t instanceof e.HTMLIFrameElement;) {
			try {
				var n = typeof t.contentWindow.location.href == "string";
			} catch {
				n = !1;
			}
			if (n) e = t.contentWindow;
			else break;
			t = P(e.document);
		}
		return t;
	}
	function Dr(e) {
		var t = e && e.nodeName && e.nodeName.toLowerCase();
		return t && (t === "input" && (e.type === "text" || e.type === "search" || e.type === "tel" || e.type === "url" || e.type === "password") || t === "textarea" || e.contentEditable === "true");
	}
	var Or = cn && "documentMode" in document && 11 >= document.documentMode, kr = null, Ar = null, jr = null, Mr = !1;
	function Nr(e, t, n) {
		var r = n.window === n ? n.document : n.nodeType === 9 ? n : n.ownerDocument;
		Mr || kr == null || kr !== P(r) || (r = kr, "selectionStart" in r && Dr(r) ? r = {
			start: r.selectionStart,
			end: r.selectionEnd
		} : (r = (r.ownerDocument && r.ownerDocument.defaultView || window).getSelection(), r = {
			anchorNode: r.anchorNode,
			anchorOffset: r.anchorOffset,
			focusNode: r.focusNode,
			focusOffset: r.focusOffset
		}), jr && Sr(jr, r) || (jr = r, r = pd(Ar, "onSelect"), 0 < r.length && (t = new bn("onSelect", "select", null, t, n), e.push({
			event: t,
			listeners: r
		}), t.target = kr)));
	}
	function Pr(e, t) {
		var n = {};
		return n[e.toLowerCase()] = t.toLowerCase(), n["Webkit" + e] = "webkit" + t, n["Moz" + e] = "moz" + t, n;
	}
	var Fr = {
		animationend: Pr("Animation", "AnimationEnd"),
		animationiteration: Pr("Animation", "AnimationIteration"),
		animationstart: Pr("Animation", "AnimationStart"),
		transitionrun: Pr("Transition", "TransitionRun"),
		transitionstart: Pr("Transition", "TransitionStart"),
		transitioncancel: Pr("Transition", "TransitionCancel"),
		transitionend: Pr("Transition", "TransitionEnd")
	}, Ir = {}, Lr = {};
	cn && (Lr = document.createElement("div").style, "AnimationEvent" in window || (delete Fr.animationend.animation, delete Fr.animationiteration.animation, delete Fr.animationstart.animation), "TransitionEvent" in window || delete Fr.transitionend.transition);
	function Rr(e) {
		if (Ir[e]) return Ir[e];
		if (!Fr[e]) return e;
		var t = Fr[e], n;
		for (n in t) if (t.hasOwnProperty(n) && n in Lr) return Ir[e] = t[n];
		return e;
	}
	var zr = Rr("animationend"), Br = Rr("animationiteration"), Vr = Rr("animationstart"), Hr = Rr("transitionrun"), Ur = Rr("transitionstart"), Wr = Rr("transitioncancel"), Gr = Rr("transitionend"), Kr = /* @__PURE__ */ new Map(), qr = "abort auxClick beforeToggle cancel canPlay canPlayThrough click close contextMenu copy cut drag dragEnd dragEnter dragExit dragLeave dragOver dragStart drop durationChange emptied encrypted ended error gotPointerCapture input invalid keyDown keyPress keyUp load loadedData loadedMetadata loadStart lostPointerCapture mouseDown mouseMove mouseOut mouseOver mouseUp paste pause play playing pointerCancel pointerDown pointerMove pointerOut pointerOver pointerUp progress rateChange reset resize seeked seeking stalled submit suspend timeUpdate touchCancel touchEnd touchStart volumeChange scroll toggle touchMove waiting wheel".split(" ");
	qr.push("scrollEnd");
	function Jr(e, t) {
		Kr.set(e, t), yt(t, [e]);
	}
	var Yr = /* @__PURE__ */ new WeakMap();
	function Xr(e, t) {
		if (typeof e == "object" && e) {
			var n = Yr.get(e);
			return n === void 0 ? (t = {
				value: e,
				source: t,
				stack: Pt(t)
			}, Yr.set(e, t), t) : n;
		}
		return {
			value: e,
			source: t,
			stack: Pt(t)
		};
	}
	var Zr = [], Qr = 0, $r = 0;
	function ei() {
		for (var e = Qr, t = $r = Qr = 0; t < e;) {
			var n = Zr[t];
			Zr[t++] = null;
			var r = Zr[t];
			Zr[t++] = null;
			var i = Zr[t];
			Zr[t++] = null;
			var a = Zr[t];
			if (Zr[t++] = null, r !== null && i !== null) {
				var o = r.pending;
				o === null ? i.next = i : (i.next = o.next, o.next = i), r.pending = i;
			}
			a !== 0 && ii(n, i, a);
		}
	}
	function ti(e, t, n, r) {
		Zr[Qr++] = e, Zr[Qr++] = t, Zr[Qr++] = n, Zr[Qr++] = r, $r |= r, e.lanes |= r, e = e.alternate, e !== null && (e.lanes |= r);
	}
	function ni(e, t, n, r) {
		return ti(e, t, n, r), ai(e);
	}
	function ri(e, t) {
		return ti(e, null, null, t), ai(e);
	}
	function ii(e, t, n) {
		e.lanes |= n;
		var r = e.alternate;
		r !== null && (r.lanes |= n);
		for (var i = !1, a = e.return; a !== null;) a.childLanes |= n, r = a.alternate, r !== null && (r.childLanes |= n), a.tag === 22 && (e = a.stateNode, e === null || e._visibility & 1 || (i = !0)), e = a, a = a.return;
		return e.tag === 3 ? (a = e.stateNode, i && t !== null && (i = 31 - Fe(n), e = a.hiddenUpdates, r = e[i], r === null ? e[i] = [t] : r.push(t), t.lane = n | 536870912), a) : null;
	}
	function ai(e) {
		if (50 < $l) throw $l = 0, eu = null, Error(i(185));
		for (var t = e.return; t !== null;) e = t, t = e.return;
		return e.tag === 3 ? e.stateNode : null;
	}
	var oi = {};
	function si(e, t, n, r) {
		this.tag = e, this.key = n, this.sibling = this.child = this.return = this.stateNode = this.type = this.elementType = null, this.index = 0, this.refCleanup = this.ref = null, this.pendingProps = t, this.dependencies = this.memoizedState = this.updateQueue = this.memoizedProps = null, this.mode = r, this.subtreeFlags = this.flags = 0, this.deletions = null, this.childLanes = this.lanes = 0, this.alternate = null;
	}
	function ci(e, t, n, r) {
		return new si(e, t, n, r);
	}
	function li(e) {
		return e = e.prototype, !(!e || !e.isReactComponent);
	}
	function ui(e, t) {
		var n = e.alternate;
		return n === null ? (n = ci(e.tag, t, e.key, e.mode), n.elementType = e.elementType, n.type = e.type, n.stateNode = e.stateNode, n.alternate = e, e.alternate = n) : (n.pendingProps = t, n.type = e.type, n.flags = 0, n.subtreeFlags = 0, n.deletions = null), n.flags = e.flags & 65011712, n.childLanes = e.childLanes, n.lanes = e.lanes, n.child = e.child, n.memoizedProps = e.memoizedProps, n.memoizedState = e.memoizedState, n.updateQueue = e.updateQueue, t = e.dependencies, n.dependencies = t === null ? null : {
			lanes: t.lanes,
			firstContext: t.firstContext
		}, n.sibling = e.sibling, n.index = e.index, n.ref = e.ref, n.refCleanup = e.refCleanup, n;
	}
	function di(e, t) {
		e.flags &= 65011714;
		var n = e.alternate;
		return n === null ? (e.childLanes = 0, e.lanes = t, e.child = null, e.subtreeFlags = 0, e.memoizedProps = null, e.memoizedState = null, e.updateQueue = null, e.dependencies = null, e.stateNode = null) : (e.childLanes = n.childLanes, e.lanes = n.lanes, e.child = n.child, e.subtreeFlags = 0, e.deletions = null, e.memoizedProps = n.memoizedProps, e.memoizedState = n.memoizedState, e.updateQueue = n.updateQueue, e.type = n.type, t = n.dependencies, e.dependencies = t === null ? null : {
			lanes: t.lanes,
			firstContext: t.firstContext
		}), e;
	}
	function fi(e, t, n, r, a, o) {
		var s = 0;
		if (r = e, typeof e == "function") li(e) && (s = 1);
		else if (typeof e == "string") s = Tf(e, n, ue.current) ? 26 : e === "html" || e === "head" || e === "body" ? 27 : 5;
		else a: switch (e) {
			case E: return e = ci(31, n, t, a), e.elementType = E, e.lanes = o, e;
			case v: return pi(n.children, a, o, t);
			case y:
				s = 8, a |= 24;
				break;
			case b: return e = ci(12, n, t, a | 2), e.elementType = b, e.lanes = o, e;
			case C: return e = ci(13, n, t, a), e.elementType = C, e.lanes = o, e;
			case w: return e = ci(19, n, t, a), e.elementType = w, e.lanes = o, e;
			default:
				if (typeof e == "object" && e) switch (e.$$typeof) {
					case ee:
					case S:
						s = 10;
						break a;
					case x:
						s = 9;
						break a;
					case te:
						s = 11;
						break a;
					case ne:
						s = 14;
						break a;
					case T:
						s = 16, r = null;
						break a;
				}
				s = 29, n = Error(i(130, e === null ? "null" : typeof e, "")), r = null;
		}
		return t = ci(s, n, t, a), t.elementType = e, t.type = r, t.lanes = o, t;
	}
	function pi(e, t, n, r) {
		return e = ci(7, e, r, t), e.lanes = n, e;
	}
	function mi(e, t, n) {
		return e = ci(6, e, null, t), e.lanes = n, e;
	}
	function hi(e, t, n) {
		return t = ci(4, e.children === null ? [] : e.children, e.key, t), t.lanes = n, t.stateNode = {
			containerInfo: e.containerInfo,
			pendingChildren: null,
			implementation: e.implementation
		}, t;
	}
	var gi = [], _i = 0, vi = null, yi = 0, bi = [], xi = 0, Si = null, Ci = 1, wi = "";
	function Ti(e, t) {
		gi[_i++] = yi, gi[_i++] = vi, vi = e, yi = t;
	}
	function Ei(e, t, n) {
		bi[xi++] = Ci, bi[xi++] = wi, bi[xi++] = Si, Si = e;
		var r = Ci;
		e = wi;
		var i = 32 - Fe(r) - 1;
		r &= ~(1 << i), n += 1;
		var a = 32 - Fe(t) + i;
		if (30 < a) {
			var o = i - i % 5;
			a = (r & (1 << o) - 1).toString(32), r >>= o, i -= o, Ci = 1 << 32 - Fe(t) + i | n << i | r, wi = a + e;
		} else Ci = 1 << a | n << i | r, wi = e;
	}
	function Di(e) {
		e.return !== null && (Ti(e, 1), Ei(e, 1, 0));
	}
	function Oi(e) {
		for (; e === vi;) vi = gi[--_i], gi[_i] = null, yi = gi[--_i], gi[_i] = null;
		for (; e === Si;) Si = bi[--xi], bi[xi] = null, wi = bi[--xi], bi[xi] = null, Ci = bi[--xi], bi[xi] = null;
	}
	var ki = null, Ai = null, R = !1, ji = null, Mi = !1, Ni = Error(i(519));
	function Pi(e) {
		throw Bi(Xr(Error(i(418, "")), e)), Ni;
	}
	function Fi(e) {
		var t = e.stateNode, n = e.type, r = e.memoizedProps;
		switch (t[rt] = e, t[it] = r, n) {
			case "dialog":
				Q("cancel", t), Q("close", t);
				break;
			case "iframe":
			case "object":
			case "embed":
				Q("load", t);
				break;
			case "video":
			case "audio":
				for (n = 0; n < id.length; n++) Q(id[n], t);
				break;
			case "source":
				Q("error", t);
				break;
			case "img":
			case "image":
			case "link":
				Q("error", t), Q("load", t);
				break;
			case "details":
				Q("toggle", t);
				break;
			case "input":
				Q("invalid", t), Vt(t, r.value, r.defaultValue, r.checked, r.defaultChecked, r.type, r.name, !0), Rt(t);
				break;
			case "select":
				Q("invalid", t);
				break;
			case "textarea": Q("invalid", t), Wt(t, r.value, r.defaultValue, r.children), Rt(t);
		}
		n = r.children, typeof n != "string" && typeof n != "number" && typeof n != "bigint" || t.textContent === "" + n || !0 === r.suppressHydrationWarning || yd(t.textContent, n) ? (r.popover != null && (Q("beforetoggle", t), Q("toggle", t)), r.onScroll != null && Q("scroll", t), r.onScrollEnd != null && Q("scrollend", t), r.onClick != null && (t.onclick = bd), t = !0) : t = !1, t || Pi(e);
	}
	function Ii(e) {
		for (ki = e.return; ki;) switch (ki.tag) {
			case 5:
			case 13:
				Mi = !1;
				return;
			case 27:
			case 3:
				Mi = !0;
				return;
			default: ki = ki.return;
		}
	}
	function Li(e) {
		if (e !== ki) return !1;
		if (!R) return Ii(e), R = !0, !1;
		var t = e.tag, n;
		if ((n = t !== 3 && t !== 27) && ((n = t === 5) && (n = e.type, n = !(n !== "form" && n !== "button") || kd(e.type, e.memoizedProps)), n = !n), n && Ai && Pi(e), Ii(e), t === 13) {
			if (e = e.memoizedState, e = e === null ? null : e.dehydrated, !e) throw Error(i(317));
			a: {
				for (e = e.nextSibling, t = 0; e;) {
					if (e.nodeType === 8) if (n = e.data, n === "/$") {
						if (t === 0) {
							Ai = Wd(e.nextSibling);
							break a;
						}
						t--;
					} else n !== "$" && n !== "$!" && n !== "$?" || t++;
					e = e.nextSibling;
				}
				Ai = null;
			}
		} else t === 27 ? (t = Ai, Ld(e.type) ? (e = Gd, Gd = null, Ai = e) : Ai = t) : Ai = ki ? Wd(e.stateNode.nextSibling) : null;
		return !0;
	}
	function Ri() {
		Ai = ki = null, R = !1;
	}
	function zi() {
		var e = ji;
		return e !== null && (Bl === null ? Bl = e : Bl.push.apply(Bl, e), ji = null), e;
	}
	function Bi(e) {
		ji === null ? ji = [e] : ji.push(e);
	}
	var Vi = ce(null), Hi = null, Ui = null;
	function Wi(e, t, n) {
		N(Vi, t._currentValue), t._currentValue = n;
	}
	function Gi(e) {
		e._currentValue = Vi.current, le(Vi);
	}
	function Ki(e, t, n) {
		for (; e !== null;) {
			var r = e.alternate;
			if ((e.childLanes & t) === t ? r !== null && (r.childLanes & t) !== t && (r.childLanes |= t) : (e.childLanes |= t, r !== null && (r.childLanes |= t)), e === n) break;
			e = e.return;
		}
	}
	function qi(e, t, n, r) {
		var a = e.child;
		for (a !== null && (a.return = e); a !== null;) {
			var o = a.dependencies;
			if (o !== null) {
				var s = a.child;
				o = o.firstContext;
				a: for (; o !== null;) {
					var c = o;
					o = a;
					for (var l = 0; l < t.length; l++) if (c.context === t[l]) {
						o.lanes |= n, c = o.alternate, c !== null && (c.lanes |= n), Ki(o.return, n, e), r || (s = null);
						break a;
					}
					o = c.next;
				}
			} else if (a.tag === 18) {
				if (s = a.return, s === null) throw Error(i(341));
				s.lanes |= n, o = s.alternate, o !== null && (o.lanes |= n), Ki(s, n, e), s = null;
			} else s = a.child;
			if (s !== null) s.return = a;
			else for (s = a; s !== null;) {
				if (s === e) {
					s = null;
					break;
				}
				if (a = s.sibling, a !== null) {
					a.return = s.return, s = a;
					break;
				}
				s = s.return;
			}
			a = s;
		}
	}
	function Ji(e, t, n, r) {
		e = null;
		for (var a = t, o = !1; a !== null;) {
			if (!o) {
				if (a.flags & 524288) o = !0;
				else if (a.flags & 262144) break;
			}
			if (a.tag === 10) {
				var s = a.alternate;
				if (s === null) throw Error(i(387));
				if (s = s.memoizedProps, s !== null) {
					var c = a.type;
					xr(a.pendingProps.value, s.value) || (e === null ? e = [c] : e.push(c));
				}
			} else if (a === pe.current) {
				if (s = a.alternate, s === null) throw Error(i(387));
				s.memoizedState.memoizedState !== a.memoizedState.memoizedState && (e === null ? e = [Ff] : e.push(Ff));
			}
			a = a.return;
		}
		e !== null && qi(t, e, n, r), t.flags |= 262144;
	}
	function Yi(e) {
		for (e = e.firstContext; e !== null;) {
			if (!xr(e.context._currentValue, e.memoizedValue)) return !0;
			e = e.next;
		}
		return !1;
	}
	function Xi(e) {
		Hi = e, Ui = null, e = e.dependencies, e !== null && (e.firstContext = null);
	}
	function Zi(e) {
		return $i(Hi, e);
	}
	function Qi(e, t) {
		return Hi === null && Xi(e), $i(e, t);
	}
	function $i(e, t) {
		var n = t._currentValue;
		if (t = {
			context: t,
			memoizedValue: n,
			next: null
		}, Ui === null) {
			if (e === null) throw Error(i(308));
			Ui = t, e.dependencies = {
				lanes: 0,
				firstContext: t
			}, e.flags |= 524288;
		} else Ui = Ui.next = t;
		return n;
	}
	var ea = typeof AbortController < "u" ? AbortController : function() {
		var e = [], t = this.signal = {
			aborted: !1,
			addEventListener: function(t, n) {
				e.push(n);
			}
		};
		this.abort = function() {
			t.aborted = !0, e.forEach(function(e) {
				return e();
			});
		};
	}, ta = t.unstable_scheduleCallback, na = t.unstable_NormalPriority, z = {
		$$typeof: S,
		Consumer: null,
		Provider: null,
		_currentValue: null,
		_currentValue2: null,
		_threadCount: 0
	};
	function ra() {
		return {
			controller: new ea(),
			data: /* @__PURE__ */ new Map(),
			refCount: 0
		};
	}
	function ia(e) {
		e.refCount--, e.refCount === 0 && ta(na, function() {
			e.controller.abort();
		});
	}
	var aa = null, oa = 0, sa = 0, ca = null;
	function la(e, t) {
		if (aa === null) {
			var n = aa = [];
			oa = 0, sa = Qu(), ca = {
				status: "pending",
				value: void 0,
				then: function(e) {
					n.push(e);
				}
			};
		}
		return oa++, t.then(ua, ua), t;
	}
	function ua() {
		if (--oa === 0 && aa !== null) {
			ca !== null && (ca.status = "fulfilled");
			var e = aa;
			aa = null, sa = 0, ca = null;
			for (var t = 0; t < e.length; t++) (0, e[t])();
		}
	}
	function da(e, t) {
		var n = [], r = {
			status: "pending",
			value: null,
			reason: null,
			then: function(e) {
				n.push(e);
			}
		};
		return e.then(function() {
			r.status = "fulfilled", r.value = t;
			for (var e = 0; e < n.length; e++) (0, n[e])(t);
		}, function(e) {
			for (r.status = "rejected", r.reason = e, e = 0; e < n.length; e++) (0, n[e])(void 0);
		}), r;
	}
	var fa = A.S;
	A.S = function(e, t) {
		typeof t == "object" && t && typeof t.then == "function" && la(e, t), fa !== null && fa(e, t);
	};
	var pa = ce(null);
	function ma() {
		var e = pa.current;
		return e === null ? q.pooledCache : e;
	}
	function ha(e, t) {
		t === null ? N(pa, pa.current) : N(pa, t.pool);
	}
	function ga() {
		var e = ma();
		return e === null ? null : {
			parent: z._currentValue,
			pool: e
		};
	}
	var _a = Error(i(460)), va = Error(i(474)), ya = Error(i(542)), ba = { then: function() {} };
	function xa(e) {
		return e = e.status, e === "fulfilled" || e === "rejected";
	}
	function Sa() {}
	function Ca(e, t, n) {
		switch (n = e[n], n === void 0 ? e.push(t) : n !== t && (t.then(Sa, Sa), t = n), t.status) {
			case "fulfilled": return t.value;
			case "rejected": throw e = t.reason, Ea(e), e;
			default:
				if (typeof t.status == "string") t.then(Sa, Sa);
				else {
					if (e = q, e !== null && 100 < e.shellSuspendCounter) throw Error(i(482));
					e = t, e.status = "pending", e.then(function(e) {
						if (t.status === "pending") {
							var n = t;
							n.status = "fulfilled", n.value = e;
						}
					}, function(e) {
						if (t.status === "pending") {
							var n = t;
							n.status = "rejected", n.reason = e;
						}
					});
				}
				switch (t.status) {
					case "fulfilled": return t.value;
					case "rejected": throw e = t.reason, Ea(e), e;
				}
				throw wa = t, _a;
		}
	}
	var wa = null;
	function Ta() {
		if (wa === null) throw Error(i(459));
		var e = wa;
		return wa = null, e;
	}
	function Ea(e) {
		if (e === _a || e === ya) throw Error(i(483));
	}
	var Da = !1;
	function Oa(e) {
		e.updateQueue = {
			baseState: e.memoizedState,
			firstBaseUpdate: null,
			lastBaseUpdate: null,
			shared: {
				pending: null,
				lanes: 0,
				hiddenCallbacks: null
			},
			callbacks: null
		};
	}
	function ka(e, t) {
		e = e.updateQueue, t.updateQueue === e && (t.updateQueue = {
			baseState: e.baseState,
			firstBaseUpdate: e.firstBaseUpdate,
			lastBaseUpdate: e.lastBaseUpdate,
			shared: e.shared,
			callbacks: null
		});
	}
	function Aa(e) {
		return {
			lane: e,
			tag: 0,
			payload: null,
			callback: null,
			next: null
		};
	}
	function ja(e, t, n) {
		var r = e.updateQueue;
		if (r === null) return null;
		if (r = r.shared, K & 2) {
			var i = r.pending;
			return i === null ? t.next = t : (t.next = i.next, i.next = t), r.pending = t, t = ai(e), ii(e, null, n), t;
		}
		return ti(e, r, t, n), ai(e);
	}
	function Ma(e, t, n) {
		if (t = t.updateQueue, t !== null && (t = t.shared, n & 4194048)) {
			var r = t.lanes;
			r &= e.pendingLanes, n |= r, t.lanes = n, Ze(e, n);
		}
	}
	function Na(e, t) {
		var n = e.updateQueue, r = e.alternate;
		if (r !== null && (r = r.updateQueue, n === r)) {
			var i = null, a = null;
			if (n = n.firstBaseUpdate, n !== null) {
				do {
					var o = {
						lane: n.lane,
						tag: n.tag,
						payload: n.payload,
						callback: null,
						next: null
					};
					a === null ? i = a = o : a = a.next = o, n = n.next;
				} while (n !== null);
				a === null ? i = a = t : a = a.next = t;
			} else i = a = t;
			n = {
				baseState: r.baseState,
				firstBaseUpdate: i,
				lastBaseUpdate: a,
				shared: r.shared,
				callbacks: r.callbacks
			}, e.updateQueue = n;
			return;
		}
		e = n.lastBaseUpdate, e === null ? n.firstBaseUpdate = t : e.next = t, n.lastBaseUpdate = t;
	}
	var Pa = !1;
	function Fa() {
		if (Pa) {
			var e = ca;
			if (e !== null) throw e;
		}
	}
	function Ia(e, t, n, r) {
		Pa = !1;
		var i = e.updateQueue;
		Da = !1;
		var a = i.firstBaseUpdate, o = i.lastBaseUpdate, s = i.shared.pending;
		if (s !== null) {
			i.shared.pending = null;
			var c = s, l = c.next;
			c.next = null, o === null ? a = l : o.next = l, o = c;
			var u = e.alternate;
			u !== null && (u = u.updateQueue, s = u.lastBaseUpdate, s !== o && (s === null ? u.firstBaseUpdate = l : s.next = l, u.lastBaseUpdate = c));
		}
		if (a !== null) {
			var d = i.baseState;
			o = 0, u = l = c = null, s = a;
			do {
				var p = s.lane & -536870913, m = p !== s.lane;
				if (m ? (Y & p) === p : (r & p) === p) {
					p !== 0 && p === sa && (Pa = !0), u !== null && (u = u.next = {
						lane: 0,
						tag: s.tag,
						payload: s.payload,
						callback: null,
						next: null
					});
					a: {
						var h = e, g = s;
						p = t;
						var _ = n;
						switch (g.tag) {
							case 1:
								if (h = g.payload, typeof h == "function") {
									d = h.call(_, d, p);
									break a;
								}
								d = h;
								break a;
							case 3: h.flags = h.flags & -65537 | 128;
							case 0:
								if (h = g.payload, p = typeof h == "function" ? h.call(_, d, p) : h, p == null) break a;
								d = f({}, d, p);
								break a;
							case 2: Da = !0;
						}
					}
					p = s.callback, p !== null && (e.flags |= 64, m && (e.flags |= 8192), m = i.callbacks, m === null ? i.callbacks = [p] : m.push(p));
				} else m = {
					lane: p,
					tag: s.tag,
					payload: s.payload,
					callback: s.callback,
					next: null
				}, u === null ? (l = u = m, c = d) : u = u.next = m, o |= p;
				if (s = s.next, s === null) {
					if (s = i.shared.pending, s === null) break;
					m = s, s = m.next, m.next = null, i.lastBaseUpdate = m, i.shared.pending = null;
				}
			} while (1);
			u === null && (c = d), i.baseState = c, i.firstBaseUpdate = l, i.lastBaseUpdate = u, a === null && (i.shared.lanes = 0), Pl |= o, e.lanes = o, e.memoizedState = d;
		}
	}
	function La(e, t) {
		if (typeof e != "function") throw Error(i(191, e));
		e.call(t);
	}
	function Ra(e, t) {
		var n = e.callbacks;
		if (n !== null) for (e.callbacks = null, e = 0; e < n.length; e++) La(n[e], t);
	}
	var za = ce(null), Ba = ce(0);
	function Va(e, t) {
		e = Ml, N(Ba, e), N(za, t), Ml = e | t.baseLanes;
	}
	function Ha() {
		N(Ba, Ml), N(za, za.current);
	}
	function Ua() {
		Ml = Ba.current, le(za), le(Ba);
	}
	var Wa = 0, B = null, V = null, Ga = null, Ka = !1, qa = !1, Ja = !1, Ya = 0, Xa = 0, Za = null, Qa = 0;
	function $a() {
		throw Error(i(321));
	}
	function eo(e, t) {
		if (t === null) return !1;
		for (var n = 0; n < t.length && n < e.length; n++) if (!xr(e[n], t[n])) return !1;
		return !0;
	}
	function to(e, t, n, r, i, a) {
		return Wa = a, B = t, t.memoizedState = null, t.updateQueue = null, t.lanes = 0, A.H = e === null || e.memoizedState === null ? gs : _s, Ja = !1, a = n(r, i), Ja = !1, qa && (a = ro(t, n, r, i)), no(e), a;
	}
	function no(e) {
		A.H = hs;
		var t = V !== null && V.next !== null;
		if (Wa = 0, Ga = V = B = null, Ka = !1, Xa = 0, Za = null, t) throw Error(i(300));
		e === null || Qs || (e = e.dependencies, e !== null && Yi(e) && (Qs = !0));
	}
	function ro(e, t, n, r) {
		B = e;
		var a = 0;
		do {
			if (qa && (Za = null), Xa = 0, qa = !1, 25 <= a) throw Error(i(301));
			if (a += 1, Ga = V = null, e.updateQueue != null) {
				var o = e.updateQueue;
				o.lastEffect = null, o.events = null, o.stores = null, o.memoCache != null && (o.memoCache.index = 0);
			}
			A.H = vs, o = t(n, r);
		} while (qa);
		return o;
	}
	function io() {
		var e = A.H, t = e.useState()[0];
		return t = typeof t.then == "function" ? fo(t) : t, e = e.useState()[0], (V === null ? null : V.memoizedState) !== e && (B.flags |= 1024), t;
	}
	function ao() {
		var e = Ya !== 0;
		return Ya = 0, e;
	}
	function oo(e, t, n) {
		t.updateQueue = e.updateQueue, t.flags &= -2053, e.lanes &= ~n;
	}
	function so(e) {
		if (Ka) {
			for (e = e.memoizedState; e !== null;) {
				var t = e.queue;
				t !== null && (t.pending = null), e = e.next;
			}
			Ka = !1;
		}
		Wa = 0, Ga = V = B = null, qa = !1, Xa = Ya = 0, Za = null;
	}
	function co() {
		var e = {
			memoizedState: null,
			baseState: null,
			baseQueue: null,
			queue: null,
			next: null
		};
		return Ga === null ? B.memoizedState = Ga = e : Ga = Ga.next = e, Ga;
	}
	function lo() {
		if (V === null) {
			var e = B.alternate;
			e = e === null ? null : e.memoizedState;
		} else e = V.next;
		var t = Ga === null ? B.memoizedState : Ga.next;
		if (t !== null) Ga = t, V = e;
		else {
			if (e === null) throw B.alternate === null ? Error(i(467)) : Error(i(310));
			V = e, e = {
				memoizedState: V.memoizedState,
				baseState: V.baseState,
				baseQueue: V.baseQueue,
				queue: V.queue,
				next: null
			}, Ga === null ? B.memoizedState = Ga = e : Ga = Ga.next = e;
		}
		return Ga;
	}
	function uo() {
		return {
			lastEffect: null,
			events: null,
			stores: null,
			memoCache: null
		};
	}
	function fo(e) {
		var t = Xa;
		return Xa += 1, Za === null && (Za = []), e = Ca(Za, e, t), t = B, (Ga === null ? t.memoizedState : Ga.next) === null && (t = t.alternate, A.H = t === null || t.memoizedState === null ? gs : _s), e;
	}
	function po(e) {
		if (typeof e == "object" && e) {
			if (typeof e.then == "function") return fo(e);
			if (e.$$typeof === S) return Zi(e);
		}
		throw Error(i(438, String(e)));
	}
	function H(e) {
		var t = null, n = B.updateQueue;
		if (n !== null && (t = n.memoCache), t == null) {
			var r = B.alternate;
			r !== null && (r = r.updateQueue, r !== null && (r = r.memoCache, r != null && (t = {
				data: r.data.map(function(e) {
					return e.slice();
				}),
				index: 0
			})));
		}
		if (t ??= {
			data: [],
			index: 0
		}, n === null && (n = uo(), B.updateQueue = n), n.memoCache = t, n = t.data[t.index], n === void 0) for (n = t.data[t.index] = Array(e), r = 0; r < e; r++) n[r] = re;
		return t.index++, n;
	}
	function U(e, t) {
		return typeof t == "function" ? t(e) : t;
	}
	function mo(e) {
		return ho(lo(), V, e);
	}
	function ho(e, t, n) {
		var r = e.queue;
		if (r === null) throw Error(i(311));
		r.lastRenderedReducer = n;
		var a = e.baseQueue, o = r.pending;
		if (o !== null) {
			if (a !== null) {
				var s = a.next;
				a.next = o.next, o.next = s;
			}
			t.baseQueue = a = o, r.pending = null;
		}
		if (o = e.baseState, a === null) e.memoizedState = o;
		else {
			t = a.next;
			var c = s = null, l = null, u = t, d = !1;
			do {
				var f = u.lane & -536870913;
				if (f === u.lane ? (Wa & f) === f : (Y & f) === f) {
					var p = u.revertLane;
					if (p === 0) l !== null && (l = l.next = {
						lane: 0,
						revertLane: 0,
						action: u.action,
						hasEagerState: u.hasEagerState,
						eagerState: u.eagerState,
						next: null
					}), f === sa && (d = !0);
					else if ((Wa & p) === p) {
						u = u.next, p === sa && (d = !0);
						continue;
					} else f = {
						lane: 0,
						revertLane: u.revertLane,
						action: u.action,
						hasEagerState: u.hasEagerState,
						eagerState: u.eagerState,
						next: null
					}, l === null ? (c = l = f, s = o) : l = l.next = f, B.lanes |= p, Pl |= p;
					f = u.action, Ja && n(o, f), o = u.hasEagerState ? u.eagerState : n(o, f);
				} else p = {
					lane: f,
					revertLane: u.revertLane,
					action: u.action,
					hasEagerState: u.hasEagerState,
					eagerState: u.eagerState,
					next: null
				}, l === null ? (c = l = p, s = o) : l = l.next = p, B.lanes |= f, Pl |= f;
				u = u.next;
			} while (u !== null && u !== t);
			if (l === null ? s = o : l.next = c, !xr(o, e.memoizedState) && (Qs = !0, d && (n = ca, n !== null))) throw n;
			e.memoizedState = o, e.baseState = s, e.baseQueue = l, r.lastRenderedState = o;
		}
		return a === null && (r.lanes = 0), [e.memoizedState, r.dispatch];
	}
	function go(e) {
		var t = lo(), n = t.queue;
		if (n === null) throw Error(i(311));
		n.lastRenderedReducer = e;
		var r = n.dispatch, a = n.pending, o = t.memoizedState;
		if (a !== null) {
			n.pending = null;
			var s = a = a.next;
			do
				o = e(o, s.action), s = s.next;
			while (s !== a);
			xr(o, t.memoizedState) || (Qs = !0), t.memoizedState = o, t.baseQueue === null && (t.baseState = o), n.lastRenderedState = o;
		}
		return [o, r];
	}
	function _o(e, t, n) {
		var r = B, a = lo(), o = R;
		if (o) {
			if (n === void 0) throw Error(i(407));
			n = n();
		} else n = t();
		var s = !xr((V || a).memoizedState, n);
		if (s && (a.memoizedState = n, Qs = !0), a = a.queue, Vo(2048, 8, bo.bind(null, r, a, e), [e]), a.getSnapshot !== t || s || Ga !== null && Ga.memoizedState.tag & 1) {
			if (r.flags |= 2048, Lo(9, Ro(), yo.bind(null, r, a, n, t), null), q === null) throw Error(i(349));
			o || Wa & 124 || vo(r, t, n);
		}
		return n;
	}
	function vo(e, t, n) {
		e.flags |= 16384, e = {
			getSnapshot: t,
			value: n
		}, t = B.updateQueue, t === null ? (t = uo(), B.updateQueue = t, t.stores = [e]) : (n = t.stores, n === null ? t.stores = [e] : n.push(e));
	}
	function yo(e, t, n, r) {
		t.value = n, t.getSnapshot = r, xo(t) && So(e);
	}
	function bo(e, t, n) {
		return n(function() {
			xo(t) && So(e);
		});
	}
	function xo(e) {
		var t = e.getSnapshot;
		e = e.value;
		try {
			var n = t();
			return !xr(e, n);
		} catch {
			return !0;
		}
	}
	function So(e) {
		var t = ri(e, 2);
		t !== null && ru(t, e, 2);
	}
	function Co(e) {
		var t = co();
		if (typeof e == "function") {
			var n = e;
			if (e = n(), Ja) {
				Pe(!0);
				try {
					n();
				} finally {
					Pe(!1);
				}
			}
		}
		return t.memoizedState = t.baseState = e, t.queue = {
			pending: null,
			lanes: 0,
			dispatch: null,
			lastRenderedReducer: U,
			lastRenderedState: e
		}, t;
	}
	function wo(e, t, n, r) {
		return e.baseState = n, ho(e, V, typeof r == "function" ? r : U);
	}
	function To(e, t, n, r, a) {
		if (fs(e)) throw Error(i(485));
		if (e = t.action, e !== null) {
			var o = {
				payload: a,
				action: e,
				next: null,
				isTransition: !0,
				status: "pending",
				value: null,
				reason: null,
				listeners: [],
				then: function(e) {
					o.listeners.push(e);
				}
			};
			A.T === null ? o.isTransition = !1 : n(!0), r(o), n = t.pending, n === null ? (o.next = t.pending = o, Eo(t, o)) : (o.next = n.next, t.pending = n.next = o);
		}
	}
	function Eo(e, t) {
		var n = t.action, r = t.payload, i = e.state;
		if (t.isTransition) {
			var a = A.T, o = {};
			A.T = o;
			try {
				var s = n(i, r), c = A.S;
				c !== null && c(o, s), Do(e, t, s);
			} catch (n) {
				ko(e, t, n);
			} finally {
				A.T = a;
			}
		} else try {
			a = n(i, r), Do(e, t, a);
		} catch (n) {
			ko(e, t, n);
		}
	}
	function Do(e, t, n) {
		typeof n == "object" && n && typeof n.then == "function" ? n.then(function(n) {
			Oo(e, t, n);
		}, function(n) {
			return ko(e, t, n);
		}) : Oo(e, t, n);
	}
	function Oo(e, t, n) {
		t.status = "fulfilled", t.value = n, Ao(t), e.state = n, t = e.pending, t !== null && (n = t.next, n === t ? e.pending = null : (n = n.next, t.next = n, Eo(e, n)));
	}
	function ko(e, t, n) {
		var r = e.pending;
		if (e.pending = null, r !== null) {
			r = r.next;
			do
				t.status = "rejected", t.reason = n, Ao(t), t = t.next;
			while (t !== r);
		}
		e.action = null;
	}
	function Ao(e) {
		e = e.listeners;
		for (var t = 0; t < e.length; t++) (0, e[t])();
	}
	function jo(e, t) {
		return t;
	}
	function Mo(e, t) {
		if (R) {
			var n = q.formState;
			if (n !== null) {
				a: {
					var r = B;
					if (R) {
						if (Ai) {
							b: {
								for (var i = Ai, a = Mi; i.nodeType !== 8;) {
									if (!a) {
										i = null;
										break b;
									}
									if (i = Wd(i.nextSibling), i === null) {
										i = null;
										break b;
									}
								}
								a = i.data, i = a === "F!" || a === "F" ? i : null;
							}
							if (i) {
								Ai = Wd(i.nextSibling), r = i.data === "F!";
								break a;
							}
						}
						Pi(r);
					}
					r = !1;
				}
				r && (t = n[0]);
			}
		}
		return n = co(), n.memoizedState = n.baseState = t, r = {
			pending: null,
			lanes: 0,
			dispatch: null,
			lastRenderedReducer: jo,
			lastRenderedState: t
		}, n.queue = r, n = ls.bind(null, B, r), r.dispatch = n, r = Co(!1), a = ds.bind(null, B, !1, r.queue), r = co(), i = {
			state: t,
			dispatch: null,
			action: e,
			pending: null
		}, r.queue = i, n = To.bind(null, B, i, a, n), i.dispatch = n, r.memoizedState = e, [
			t,
			n,
			!1
		];
	}
	function No(e) {
		return Po(lo(), V, e);
	}
	function Po(e, t, n) {
		if (t = ho(e, t, jo)[0], e = mo(U)[0], typeof t == "object" && t && typeof t.then == "function") try {
			var r = fo(t);
		} catch (e) {
			throw e === _a ? ya : e;
		}
		else r = t;
		t = lo();
		var i = t.queue, a = i.dispatch;
		return n !== t.memoizedState && (B.flags |= 2048, Lo(9, Ro(), Fo.bind(null, i, n), null)), [
			r,
			a,
			e
		];
	}
	function Fo(e, t) {
		e.action = t;
	}
	function Io(e) {
		var t = lo(), n = V;
		if (n !== null) return Po(t, n, e);
		lo(), t = t.memoizedState, n = lo();
		var r = n.queue.dispatch;
		return n.memoizedState = e, [
			t,
			r,
			!1
		];
	}
	function Lo(e, t, n, r) {
		return e = {
			tag: e,
			create: n,
			deps: r,
			inst: t,
			next: null
		}, t = B.updateQueue, t === null && (t = uo(), B.updateQueue = t), n = t.lastEffect, n === null ? t.lastEffect = e.next = e : (r = n.next, n.next = e, e.next = r, t.lastEffect = e), e;
	}
	function Ro() {
		return {
			destroy: void 0,
			resource: void 0
		};
	}
	function zo() {
		return lo().memoizedState;
	}
	function Bo(e, t, n, r) {
		var i = co();
		r = r === void 0 ? null : r, B.flags |= e, i.memoizedState = Lo(1 | t, Ro(), n, r);
	}
	function Vo(e, t, n, r) {
		var i = lo();
		r = r === void 0 ? null : r;
		var a = i.memoizedState.inst;
		V !== null && r !== null && eo(r, V.memoizedState.deps) ? i.memoizedState = Lo(t, a, n, r) : (B.flags |= e, i.memoizedState = Lo(1 | t, a, n, r));
	}
	function Ho(e, t) {
		Bo(8390656, 8, e, t);
	}
	function Uo(e, t) {
		Vo(2048, 8, e, t);
	}
	function Wo(e, t) {
		return Vo(4, 2, e, t);
	}
	function Go(e, t) {
		return Vo(4, 4, e, t);
	}
	function Ko(e, t) {
		if (typeof t == "function") {
			e = e();
			var n = t(e);
			return function() {
				typeof n == "function" ? n() : t(null);
			};
		}
		if (t != null) return e = e(), t.current = e, function() {
			t.current = null;
		};
	}
	function qo(e, t, n) {
		n = n == null ? null : n.concat([e]), Vo(4, 4, Ko.bind(null, t, e), n);
	}
	function Jo() {}
	function Yo(e, t) {
		var n = lo();
		t = t === void 0 ? null : t;
		var r = n.memoizedState;
		return t !== null && eo(t, r[1]) ? r[0] : (n.memoizedState = [e, t], e);
	}
	function Xo(e, t) {
		var n = lo();
		t = t === void 0 ? null : t;
		var r = n.memoizedState;
		if (t !== null && eo(t, r[1])) return r[0];
		if (r = e(), Ja) {
			Pe(!0);
			try {
				e();
			} finally {
				Pe(!1);
			}
		}
		return n.memoizedState = [r, t], r;
	}
	function Zo(e, t, n) {
		return n === void 0 || Wa & 1073741824 ? e.memoizedState = t : (e.memoizedState = n, e = nu(), B.lanes |= e, Pl |= e, n);
	}
	function Qo(e, t, n, r) {
		return xr(n, t) ? n : za.current === null ? Wa & 42 ? (e = nu(), B.lanes |= e, Pl |= e, t) : (Qs = !0, e.memoizedState = n) : (e = Zo(e, n, r), xr(e, t) || (Qs = !0), e);
	}
	function $o(e, t, n, r, i) {
		var a = j.p;
		j.p = a !== 0 && 8 > a ? a : 8;
		var o = A.T, s = {};
		A.T = s, ds(e, !1, t, n);
		try {
			var c = i(), l = A.S;
			l !== null && l(s, c), typeof c == "object" && c && typeof c.then == "function" ? us(e, t, da(c, r), tu(e)) : us(e, t, r, tu(e));
		} catch (n) {
			us(e, t, {
				then: function() {},
				status: "rejected",
				reason: n
			}, tu());
		} finally {
			j.p = a, A.T = o;
		}
	}
	function es() {}
	function ts(e, t, n, r) {
		if (e.tag !== 5) throw Error(i(476));
		var a = ns(e).queue;
		$o(e, a, t, M, n === null ? es : function() {
			return rs(e), n(r);
		});
	}
	function ns(e) {
		var t = e.memoizedState;
		if (t !== null) return t;
		t = {
			memoizedState: M,
			baseState: M,
			baseQueue: null,
			queue: {
				pending: null,
				lanes: 0,
				dispatch: null,
				lastRenderedReducer: U,
				lastRenderedState: M
			},
			next: null
		};
		var n = {};
		return t.next = {
			memoizedState: n,
			baseState: n,
			baseQueue: null,
			queue: {
				pending: null,
				lanes: 0,
				dispatch: null,
				lastRenderedReducer: U,
				lastRenderedState: n
			},
			next: null
		}, e.memoizedState = t, e = e.alternate, e !== null && (e.memoizedState = t), t;
	}
	function rs(e) {
		var t = ns(e).next.queue;
		us(e, t, {}, tu());
	}
	function is() {
		return Zi(Ff);
	}
	function as() {
		return lo().memoizedState;
	}
	function os() {
		return lo().memoizedState;
	}
	function ss(e) {
		for (var t = e.return; t !== null;) {
			switch (t.tag) {
				case 24:
				case 3:
					var n = tu();
					e = Aa(n);
					var r = ja(t, e, n);
					r !== null && (ru(r, t, n), Ma(r, t, n)), t = { cache: ra() }, e.payload = t;
					return;
			}
			t = t.return;
		}
	}
	function cs(e, t, n) {
		var r = tu();
		n = {
			lane: r,
			revertLane: 0,
			action: n,
			hasEagerState: !1,
			eagerState: null,
			next: null
		}, fs(e) ? ps(t, n) : (n = ni(e, t, n, r), n !== null && (ru(n, e, r), ms(n, t, r)));
	}
	function ls(e, t, n) {
		us(e, t, n, tu());
	}
	function us(e, t, n, r) {
		var i = {
			lane: r,
			revertLane: 0,
			action: n,
			hasEagerState: !1,
			eagerState: null,
			next: null
		};
		if (fs(e)) ps(t, i);
		else {
			var a = e.alternate;
			if (e.lanes === 0 && (a === null || a.lanes === 0) && (a = t.lastRenderedReducer, a !== null)) try {
				var o = t.lastRenderedState, s = a(o, n);
				if (i.hasEagerState = !0, i.eagerState = s, xr(s, o)) return ti(e, t, i, 0), q === null && ei(), !1;
			} catch {}
			if (n = ni(e, t, i, r), n !== null) return ru(n, e, r), ms(n, t, r), !0;
		}
		return !1;
	}
	function ds(e, t, n, r) {
		if (r = {
			lane: 2,
			revertLane: Qu(),
			action: r,
			hasEagerState: !1,
			eagerState: null,
			next: null
		}, fs(e)) {
			if (t) throw Error(i(479));
		} else t = ni(e, n, r, 2), t !== null && ru(t, e, 2);
	}
	function fs(e) {
		var t = e.alternate;
		return e === B || t !== null && t === B;
	}
	function ps(e, t) {
		qa = Ka = !0;
		var n = e.pending;
		n === null ? t.next = t : (t.next = n.next, n.next = t), e.pending = t;
	}
	function ms(e, t, n) {
		if (n & 4194048) {
			var r = t.lanes;
			r &= e.pendingLanes, n |= r, t.lanes = n, Ze(e, n);
		}
	}
	var hs = {
		readContext: Zi,
		use: po,
		useCallback: $a,
		useContext: $a,
		useEffect: $a,
		useImperativeHandle: $a,
		useLayoutEffect: $a,
		useInsertionEffect: $a,
		useMemo: $a,
		useReducer: $a,
		useRef: $a,
		useState: $a,
		useDebugValue: $a,
		useDeferredValue: $a,
		useTransition: $a,
		useSyncExternalStore: $a,
		useId: $a,
		useHostTransitionStatus: $a,
		useFormState: $a,
		useActionState: $a,
		useOptimistic: $a,
		useMemoCache: $a,
		useCacheRefresh: $a
	}, gs = {
		readContext: Zi,
		use: po,
		useCallback: function(e, t) {
			return co().memoizedState = [e, t === void 0 ? null : t], e;
		},
		useContext: Zi,
		useEffect: Ho,
		useImperativeHandle: function(e, t, n) {
			n = n == null ? null : n.concat([e]), Bo(4194308, 4, Ko.bind(null, t, e), n);
		},
		useLayoutEffect: function(e, t) {
			return Bo(4194308, 4, e, t);
		},
		useInsertionEffect: function(e, t) {
			Bo(4, 2, e, t);
		},
		useMemo: function(e, t) {
			var n = co();
			t = t === void 0 ? null : t;
			var r = e();
			if (Ja) {
				Pe(!0);
				try {
					e();
				} finally {
					Pe(!1);
				}
			}
			return n.memoizedState = [r, t], r;
		},
		useReducer: function(e, t, n) {
			var r = co();
			if (n !== void 0) {
				var i = n(t);
				if (Ja) {
					Pe(!0);
					try {
						n(t);
					} finally {
						Pe(!1);
					}
				}
			} else i = t;
			return r.memoizedState = r.baseState = i, e = {
				pending: null,
				lanes: 0,
				dispatch: null,
				lastRenderedReducer: e,
				lastRenderedState: i
			}, r.queue = e, e = e.dispatch = cs.bind(null, B, e), [r.memoizedState, e];
		},
		useRef: function(e) {
			var t = co();
			return e = { current: e }, t.memoizedState = e;
		},
		useState: function(e) {
			e = Co(e);
			var t = e.queue, n = ls.bind(null, B, t);
			return t.dispatch = n, [e.memoizedState, n];
		},
		useDebugValue: Jo,
		useDeferredValue: function(e, t) {
			return Zo(co(), e, t);
		},
		useTransition: function() {
			var e = Co(!1);
			return e = $o.bind(null, B, e.queue, !0, !1), co().memoizedState = e, [!1, e];
		},
		useSyncExternalStore: function(e, t, n) {
			var r = B, a = co();
			if (R) {
				if (n === void 0) throw Error(i(407));
				n = n();
			} else {
				if (n = t(), q === null) throw Error(i(349));
				Y & 124 || vo(r, t, n);
			}
			a.memoizedState = n;
			var o = {
				value: n,
				getSnapshot: t
			};
			return a.queue = o, Ho(bo.bind(null, r, o, e), [e]), r.flags |= 2048, Lo(9, Ro(), yo.bind(null, r, o, n, t), null), n;
		},
		useId: function() {
			var e = co(), t = q.identifierPrefix;
			if (R) {
				var n = wi, r = Ci;
				n = (r & ~(1 << 32 - Fe(r) - 1)).toString(32) + n, t = "«" + t + "R" + n, n = Ya++, 0 < n && (t += "H" + n.toString(32)), t += "»";
			} else n = Qa++, t = "«" + t + "r" + n.toString(32) + "»";
			return e.memoizedState = t;
		},
		useHostTransitionStatus: is,
		useFormState: Mo,
		useActionState: Mo,
		useOptimistic: function(e) {
			var t = co();
			t.memoizedState = t.baseState = e;
			var n = {
				pending: null,
				lanes: 0,
				dispatch: null,
				lastRenderedReducer: null,
				lastRenderedState: null
			};
			return t.queue = n, t = ds.bind(null, B, !0, n), n.dispatch = t, [e, t];
		},
		useMemoCache: H,
		useCacheRefresh: function() {
			return co().memoizedState = ss.bind(null, B);
		}
	}, _s = {
		readContext: Zi,
		use: po,
		useCallback: Yo,
		useContext: Zi,
		useEffect: Uo,
		useImperativeHandle: qo,
		useInsertionEffect: Wo,
		useLayoutEffect: Go,
		useMemo: Xo,
		useReducer: mo,
		useRef: zo,
		useState: function() {
			return mo(U);
		},
		useDebugValue: Jo,
		useDeferredValue: function(e, t) {
			return Qo(lo(), V.memoizedState, e, t);
		},
		useTransition: function() {
			var e = mo(U)[0], t = lo().memoizedState;
			return [typeof e == "boolean" ? e : fo(e), t];
		},
		useSyncExternalStore: _o,
		useId: as,
		useHostTransitionStatus: is,
		useFormState: No,
		useActionState: No,
		useOptimistic: function(e, t) {
			return wo(lo(), V, e, t);
		},
		useMemoCache: H,
		useCacheRefresh: os
	}, vs = {
		readContext: Zi,
		use: po,
		useCallback: Yo,
		useContext: Zi,
		useEffect: Uo,
		useImperativeHandle: qo,
		useInsertionEffect: Wo,
		useLayoutEffect: Go,
		useMemo: Xo,
		useReducer: go,
		useRef: zo,
		useState: function() {
			return go(U);
		},
		useDebugValue: Jo,
		useDeferredValue: function(e, t) {
			var n = lo();
			return V === null ? Zo(n, e, t) : Qo(n, V.memoizedState, e, t);
		},
		useTransition: function() {
			var e = go(U)[0], t = lo().memoizedState;
			return [typeof e == "boolean" ? e : fo(e), t];
		},
		useSyncExternalStore: _o,
		useId: as,
		useHostTransitionStatus: is,
		useFormState: Io,
		useActionState: Io,
		useOptimistic: function(e, t) {
			var n = lo();
			return V === null ? (n.baseState = e, [e, n.queue.dispatch]) : wo(n, V, e, t);
		},
		useMemoCache: H,
		useCacheRefresh: os
	}, ys = null, bs = 0;
	function xs(e) {
		var t = bs;
		return bs += 1, ys === null && (ys = []), Ca(ys, e, t);
	}
	function Ss(e, t) {
		t = t.props.ref, e.ref = t === void 0 ? null : t;
	}
	function Cs(e, t) {
		throw t.$$typeof === m ? Error(i(525)) : (e = Object.prototype.toString.call(t), Error(i(31, e === "[object Object]" ? "object with keys {" + Object.keys(t).join(", ") + "}" : e)));
	}
	function ws(e) {
		var t = e._init;
		return t(e._payload);
	}
	function Ts(e) {
		function t(t, n) {
			if (e) {
				var r = t.deletions;
				r === null ? (t.deletions = [n], t.flags |= 16) : r.push(n);
			}
		}
		function n(n, r) {
			if (!e) return null;
			for (; r !== null;) t(n, r), r = r.sibling;
			return null;
		}
		function r(e) {
			for (var t = /* @__PURE__ */ new Map(); e !== null;) e.key === null ? t.set(e.index, e) : t.set(e.key, e), e = e.sibling;
			return t;
		}
		function a(e, t) {
			return e = ui(e, t), e.index = 0, e.sibling = null, e;
		}
		function o(t, n, r) {
			return t.index = r, e ? (r = t.alternate, r === null ? (t.flags |= 67108866, n) : (r = r.index, r < n ? (t.flags |= 67108866, n) : r)) : (t.flags |= 1048576, n);
		}
		function s(t) {
			return e && t.alternate === null && (t.flags |= 67108866), t;
		}
		function c(e, t, n, r) {
			return t === null || t.tag !== 6 ? (t = mi(n, e.mode, r), t.return = e, t) : (t = a(t, n), t.return = e, t);
		}
		function l(e, t, n, r) {
			var i = n.type;
			return i === v ? d(e, t, n.props.children, r, n.key) : t !== null && (t.elementType === i || typeof i == "object" && i && i.$$typeof === T && ws(i) === t.type) ? (t = a(t, n.props), Ss(t, n), t.return = e, t) : (t = fi(n.type, n.key, n.props, null, e.mode, r), Ss(t, n), t.return = e, t);
		}
		function u(e, t, n, r) {
			return t === null || t.tag !== 4 || t.stateNode.containerInfo !== n.containerInfo || t.stateNode.implementation !== n.implementation ? (t = hi(n, e.mode, r), t.return = e, t) : (t = a(t, n.children || []), t.return = e, t);
		}
		function d(e, t, n, r, i) {
			return t === null || t.tag !== 7 ? (t = pi(n, e.mode, r, i), t.return = e, t) : (t = a(t, n), t.return = e, t);
		}
		function f(e, t, n) {
			if (typeof t == "string" && t !== "" || typeof t == "number" || typeof t == "bigint") return t = mi("" + t, e.mode, n), t.return = e, t;
			if (typeof t == "object" && t) {
				switch (t.$$typeof) {
					case g: return n = fi(t.type, t.key, t.props, null, e.mode, n), Ss(n, t), n.return = e, n;
					case _: return t = hi(t, e.mode, n), t.return = e, t;
					case T:
						var r = t._init;
						return t = r(t._payload), f(e, t, n);
				}
				if (k(t) || D(t)) return t = pi(t, e.mode, n, null), t.return = e, t;
				if (typeof t.then == "function") return f(e, xs(t), n);
				if (t.$$typeof === S) return f(e, Qi(e, t), n);
				Cs(e, t);
			}
			return null;
		}
		function p(e, t, n, r) {
			var i = t === null ? null : t.key;
			if (typeof n == "string" && n !== "" || typeof n == "number" || typeof n == "bigint") return i === null ? c(e, t, "" + n, r) : null;
			if (typeof n == "object" && n) {
				switch (n.$$typeof) {
					case g: return n.key === i ? l(e, t, n, r) : null;
					case _: return n.key === i ? u(e, t, n, r) : null;
					case T: return i = n._init, n = i(n._payload), p(e, t, n, r);
				}
				if (k(n) || D(n)) return i === null ? d(e, t, n, r, null) : null;
				if (typeof n.then == "function") return p(e, t, xs(n), r);
				if (n.$$typeof === S) return p(e, t, Qi(e, n), r);
				Cs(e, n);
			}
			return null;
		}
		function m(e, t, n, r, i) {
			if (typeof r == "string" && r !== "" || typeof r == "number" || typeof r == "bigint") return e = e.get(n) || null, c(t, e, "" + r, i);
			if (typeof r == "object" && r) {
				switch (r.$$typeof) {
					case g: return e = e.get(r.key === null ? n : r.key) || null, l(t, e, r, i);
					case _: return e = e.get(r.key === null ? n : r.key) || null, u(t, e, r, i);
					case T:
						var a = r._init;
						return r = a(r._payload), m(e, t, n, r, i);
				}
				if (k(r) || D(r)) return e = e.get(n) || null, d(t, e, r, i, null);
				if (typeof r.then == "function") return m(e, t, n, xs(r), i);
				if (r.$$typeof === S) return m(e, t, n, Qi(t, r), i);
				Cs(t, r);
			}
			return null;
		}
		function h(i, a, s, c) {
			for (var l = null, u = null, d = a, h = a = 0, g = null; d !== null && h < s.length; h++) {
				d.index > h ? (g = d, d = null) : g = d.sibling;
				var _ = p(i, d, s[h], c);
				if (_ === null) {
					d === null && (d = g);
					break;
				}
				e && d && _.alternate === null && t(i, d), a = o(_, a, h), u === null ? l = _ : u.sibling = _, u = _, d = g;
			}
			if (h === s.length) return n(i, d), R && Ti(i, h), l;
			if (d === null) {
				for (; h < s.length; h++) d = f(i, s[h], c), d !== null && (a = o(d, a, h), u === null ? l = d : u.sibling = d, u = d);
				return R && Ti(i, h), l;
			}
			for (d = r(d); h < s.length; h++) g = m(d, i, h, s[h], c), g !== null && (e && g.alternate !== null && d.delete(g.key === null ? h : g.key), a = o(g, a, h), u === null ? l = g : u.sibling = g, u = g);
			return e && d.forEach(function(e) {
				return t(i, e);
			}), R && Ti(i, h), l;
		}
		function y(a, s, c, l) {
			if (c == null) throw Error(i(151));
			for (var u = null, d = null, h = s, g = s = 0, _ = null, v = c.next(); h !== null && !v.done; g++, v = c.next()) {
				h.index > g ? (_ = h, h = null) : _ = h.sibling;
				var y = p(a, h, v.value, l);
				if (y === null) {
					h === null && (h = _);
					break;
				}
				e && h && y.alternate === null && t(a, h), s = o(y, s, g), d === null ? u = y : d.sibling = y, d = y, h = _;
			}
			if (v.done) return n(a, h), R && Ti(a, g), u;
			if (h === null) {
				for (; !v.done; g++, v = c.next()) v = f(a, v.value, l), v !== null && (s = o(v, s, g), d === null ? u = v : d.sibling = v, d = v);
				return R && Ti(a, g), u;
			}
			for (h = r(h); !v.done; g++, v = c.next()) v = m(h, a, g, v.value, l), v !== null && (e && v.alternate !== null && h.delete(v.key === null ? g : v.key), s = o(v, s, g), d === null ? u = v : d.sibling = v, d = v);
			return e && h.forEach(function(e) {
				return t(a, e);
			}), R && Ti(a, g), u;
		}
		function b(e, r, o, c) {
			if (typeof o == "object" && o && o.type === v && o.key === null && (o = o.props.children), typeof o == "object" && o) {
				switch (o.$$typeof) {
					case g:
						a: {
							for (var l = o.key; r !== null;) {
								if (r.key === l) {
									if (l = o.type, l === v) {
										if (r.tag === 7) {
											n(e, r.sibling), c = a(r, o.props.children), c.return = e, e = c;
											break a;
										}
									} else if (r.elementType === l || typeof l == "object" && l && l.$$typeof === T && ws(l) === r.type) {
										n(e, r.sibling), c = a(r, o.props), Ss(c, o), c.return = e, e = c;
										break a;
									}
									n(e, r);
									break;
								} else t(e, r);
								r = r.sibling;
							}
							o.type === v ? (c = pi(o.props.children, e.mode, c, o.key), c.return = e, e = c) : (c = fi(o.type, o.key, o.props, null, e.mode, c), Ss(c, o), c.return = e, e = c);
						}
						return s(e);
					case _:
						a: {
							for (l = o.key; r !== null;) {
								if (r.key === l) if (r.tag === 4 && r.stateNode.containerInfo === o.containerInfo && r.stateNode.implementation === o.implementation) {
									n(e, r.sibling), c = a(r, o.children || []), c.return = e, e = c;
									break a;
								} else {
									n(e, r);
									break;
								}
								else t(e, r);
								r = r.sibling;
							}
							c = hi(o, e.mode, c), c.return = e, e = c;
						}
						return s(e);
					case T: return l = o._init, o = l(o._payload), b(e, r, o, c);
				}
				if (k(o)) return h(e, r, o, c);
				if (D(o)) {
					if (l = D(o), typeof l != "function") throw Error(i(150));
					return o = l.call(o), y(e, r, o, c);
				}
				if (typeof o.then == "function") return b(e, r, xs(o), c);
				if (o.$$typeof === S) return b(e, r, Qi(e, o), c);
				Cs(e, o);
			}
			return typeof o == "string" && o !== "" || typeof o == "number" || typeof o == "bigint" ? (o = "" + o, r !== null && r.tag === 6 ? (n(e, r.sibling), c = a(r, o), c.return = e, e = c) : (n(e, r), c = mi(o, e.mode, c), c.return = e, e = c), s(e)) : n(e, r);
		}
		return function(e, t, n, r) {
			try {
				bs = 0;
				var i = b(e, t, n, r);
				return ys = null, i;
			} catch (t) {
				if (t === _a || t === ya) throw t;
				var a = ci(29, t, null, e.mode);
				return a.lanes = r, a.return = e, a;
			}
		};
	}
	var Es = Ts(!0), Ds = Ts(!1), Os = ce(null), ks = null;
	function As(e) {
		var t = e.alternate;
		N(Ps, Ps.current & 1), N(Os, e), ks === null && (t === null || za.current !== null || t.memoizedState !== null) && (ks = e);
	}
	function js(e) {
		if (e.tag === 22) {
			if (N(Ps, Ps.current), N(Os, e), ks === null) {
				var t = e.alternate;
				t !== null && t.memoizedState !== null && (ks = e);
			}
		} else Ms(e);
	}
	function Ms() {
		N(Ps, Ps.current), N(Os, Os.current);
	}
	function Ns(e) {
		le(Os), ks === e && (ks = null), le(Ps);
	}
	var Ps = ce(0);
	function Fs(e) {
		for (var t = e; t !== null;) {
			if (t.tag === 13) {
				var n = t.memoizedState;
				if (n !== null && (n = n.dehydrated, n === null || n.data === "$?" || Hd(n))) return t;
			} else if (t.tag === 19 && t.memoizedProps.revealOrder !== void 0) {
				if (t.flags & 128) return t;
			} else if (t.child !== null) {
				t.child.return = t, t = t.child;
				continue;
			}
			if (t === e) break;
			for (; t.sibling === null;) {
				if (t.return === null || t.return === e) return null;
				t = t.return;
			}
			t.sibling.return = t.return, t = t.sibling;
		}
		return null;
	}
	function Is(e, t, n, r) {
		t = e.memoizedState, n = n(r, t), n = n == null ? t : f({}, t, n), e.memoizedState = n, e.lanes === 0 && (e.updateQueue.baseState = n);
	}
	var Ls = {
		enqueueSetState: function(e, t, n) {
			e = e._reactInternals;
			var r = tu(), i = Aa(r);
			i.payload = t, n != null && (i.callback = n), t = ja(e, i, r), t !== null && (ru(t, e, r), Ma(t, e, r));
		},
		enqueueReplaceState: function(e, t, n) {
			e = e._reactInternals;
			var r = tu(), i = Aa(r);
			i.tag = 1, i.payload = t, n != null && (i.callback = n), t = ja(e, i, r), t !== null && (ru(t, e, r), Ma(t, e, r));
		},
		enqueueForceUpdate: function(e, t) {
			e = e._reactInternals;
			var n = tu(), r = Aa(n);
			r.tag = 2, t != null && (r.callback = t), t = ja(e, r, n), t !== null && (ru(t, e, n), Ma(t, e, n));
		}
	};
	function Rs(e, t, n, r, i, a, o) {
		return e = e.stateNode, typeof e.shouldComponentUpdate == "function" ? e.shouldComponentUpdate(r, a, o) : t.prototype && t.prototype.isPureReactComponent ? !Sr(n, r) || !Sr(i, a) : !0;
	}
	function zs(e, t, n, r) {
		e = t.state, typeof t.componentWillReceiveProps == "function" && t.componentWillReceiveProps(n, r), typeof t.UNSAFE_componentWillReceiveProps == "function" && t.UNSAFE_componentWillReceiveProps(n, r), t.state !== e && Ls.enqueueReplaceState(t, t.state, null);
	}
	function Bs(e, t) {
		var n = t;
		if ("ref" in t) for (var r in n = {}, t) r !== "ref" && (n[r] = t[r]);
		if (e = e.defaultProps) for (var i in n === t && (n = f({}, n)), e) n[i] === void 0 && (n[i] = e[i]);
		return n;
	}
	var Vs = typeof reportError == "function" ? reportError : function(e) {
		if (typeof window == "object" && typeof window.ErrorEvent == "function") {
			var t = new window.ErrorEvent("error", {
				bubbles: !0,
				cancelable: !0,
				message: typeof e == "object" && e && typeof e.message == "string" ? String(e.message) : String(e),
				error: e
			});
			if (!window.dispatchEvent(t)) return;
		} else if (typeof process == "object" && typeof process.emit == "function") {
			process.emit("uncaughtException", e);
			return;
		}
		console.error(e);
	};
	function Hs(e) {
		Vs(e);
	}
	function Us(e) {
		console.error(e);
	}
	function Ws(e) {
		Vs(e);
	}
	function Gs(e, t) {
		try {
			var n = e.onUncaughtError;
			n(t.value, { componentStack: t.stack });
		} catch (e) {
			setTimeout(function() {
				throw e;
			});
		}
	}
	function Ks(e, t, n) {
		try {
			var r = e.onCaughtError;
			r(n.value, {
				componentStack: n.stack,
				errorBoundary: t.tag === 1 ? t.stateNode : null
			});
		} catch (e) {
			setTimeout(function() {
				throw e;
			});
		}
	}
	function qs(e, t, n) {
		return n = Aa(n), n.tag = 3, n.payload = { element: null }, n.callback = function() {
			Gs(e, t);
		}, n;
	}
	function Js(e) {
		return e = Aa(e), e.tag = 3, e;
	}
	function Ys(e, t, n, r) {
		var i = n.type.getDerivedStateFromError;
		if (typeof i == "function") {
			var a = r.value;
			e.payload = function() {
				return i(a);
			}, e.callback = function() {
				Ks(t, n, r);
			};
		}
		var o = n.stateNode;
		o !== null && typeof o.componentDidCatch == "function" && (e.callback = function() {
			Ks(t, n, r), typeof i != "function" && (Gl === null ? Gl = new Set([this]) : Gl.add(this));
			var e = r.stack;
			this.componentDidCatch(r.value, { componentStack: e === null ? "" : e });
		});
	}
	function Xs(e, t, n, r, a) {
		if (n.flags |= 32768, typeof r == "object" && r && typeof r.then == "function") {
			if (t = n.alternate, t !== null && Ji(t, n, a, !0), n = Os.current, n !== null) {
				switch (n.tag) {
					case 13: return ks === null ? mu() : n.alternate === null && Nl === 0 && (Nl = 3), n.flags &= -257, n.flags |= 65536, n.lanes = a, r === ba ? n.flags |= 16384 : (t = n.updateQueue, t === null ? n.updateQueue = new Set([r]) : t.add(r), Mu(e, r, a)), !1;
					case 22: return n.flags |= 65536, r === ba ? n.flags |= 16384 : (t = n.updateQueue, t === null ? (t = {
						transitions: null,
						markerInstances: null,
						retryQueue: new Set([r])
					}, n.updateQueue = t) : (n = t.retryQueue, n === null ? t.retryQueue = new Set([r]) : n.add(r)), Mu(e, r, a)), !1;
				}
				throw Error(i(435, n.tag));
			}
			return Mu(e, r, a), mu(), !1;
		}
		if (R) return t = Os.current, t === null ? (r !== Ni && (t = Error(i(423), { cause: r }), Bi(Xr(t, n))), e = e.current.alternate, e.flags |= 65536, a &= -a, e.lanes |= a, r = Xr(r, n), a = qs(e.stateNode, r, a), Na(e, a), Nl !== 4 && (Nl = 2)) : (!(t.flags & 65536) && (t.flags |= 256), t.flags |= 65536, t.lanes = a, r !== Ni && (e = Error(i(422), { cause: r }), Bi(Xr(e, n)))), !1;
		var o = Error(i(520), { cause: r });
		if (o = Xr(o, n), zl === null ? zl = [o] : zl.push(o), Nl !== 4 && (Nl = 2), t === null) return !0;
		r = Xr(r, n), n = t;
		do {
			switch (n.tag) {
				case 3: return n.flags |= 65536, e = a & -a, n.lanes |= e, e = qs(n.stateNode, r, e), Na(n, e), !1;
				case 1: if (t = n.type, o = n.stateNode, !(n.flags & 128) && (typeof t.getDerivedStateFromError == "function" || o !== null && typeof o.componentDidCatch == "function" && (Gl === null || !Gl.has(o)))) return n.flags |= 65536, a &= -a, n.lanes |= a, a = Js(a), Ys(a, e, n, r), Na(n, a), !1;
			}
			n = n.return;
		} while (n !== null);
		return !1;
	}
	var Zs = Error(i(461)), Qs = !1;
	function $s(e, t, n, r) {
		t.child = e === null ? Ds(t, null, n, r) : Es(t, e.child, n, r);
	}
	function ec(e, t, n, r, i) {
		n = n.render;
		var a = t.ref;
		if ("ref" in r) {
			var o = {};
			for (var s in r) s !== "ref" && (o[s] = r[s]);
		} else o = r;
		return Xi(t), r = to(e, t, n, o, a, i), s = ao(), e !== null && !Qs ? (oo(e, t, i), bc(e, t, i)) : (R && s && Di(t), t.flags |= 1, $s(e, t, r, i), t.child);
	}
	function tc(e, t, n, r, i) {
		if (e === null) {
			var a = n.type;
			return typeof a == "function" && !li(a) && a.defaultProps === void 0 && n.compare === null ? (t.tag = 15, t.type = a, nc(e, t, a, r, i)) : (e = fi(n.type, null, r, t, t.mode, i), e.ref = t.ref, e.return = t, t.child = e);
		}
		if (a = e.child, !xc(e, i)) {
			var o = a.memoizedProps;
			if (n = n.compare, n = n === null ? Sr : n, n(o, r) && e.ref === t.ref) return bc(e, t, i);
		}
		return t.flags |= 1, e = ui(a, r), e.ref = t.ref, e.return = t, t.child = e;
	}
	function nc(e, t, n, r, i) {
		if (e !== null) {
			var a = e.memoizedProps;
			if (Sr(a, r) && e.ref === t.ref) if (Qs = !1, t.pendingProps = r = a, xc(e, i)) e.flags & 131072 && (Qs = !0);
			else return t.lanes = e.lanes, bc(e, t, i);
		}
		return oc(e, t, n, r, i);
	}
	function rc(e, t, n) {
		var r = t.pendingProps, i = r.children, a = e === null ? null : e.memoizedState;
		if (r.mode === "hidden") {
			if (t.flags & 128) {
				if (r = a === null ? n : a.baseLanes | n, e !== null) {
					for (i = t.child = e.child, a = 0; i !== null;) a = a | i.lanes | i.childLanes, i = i.sibling;
					t.childLanes = a & ~r;
				} else t.childLanes = 0, t.child = null;
				return ic(e, t, r, n);
			}
			if (n & 536870912) t.memoizedState = {
				baseLanes: 0,
				cachePool: null
			}, e !== null && ha(t, a === null ? null : a.cachePool), a === null ? Ha() : Va(t, a), js(t);
			else return t.lanes = t.childLanes = 536870912, ic(e, t, a === null ? n : a.baseLanes | n, n);
		} else a === null ? (e !== null && ha(t, null), Ha(), Ms(t)) : (ha(t, a.cachePool), Va(t, a), Ms(t), t.memoizedState = null);
		return $s(e, t, i, n), t.child;
	}
	function ic(e, t, n, r) {
		var i = ma();
		return i = i === null ? null : {
			parent: z._currentValue,
			pool: i
		}, t.memoizedState = {
			baseLanes: n,
			cachePool: i
		}, e !== null && ha(t, null), Ha(), js(t), e !== null && Ji(e, t, r, !0), null;
	}
	function ac(e, t) {
		var n = t.ref;
		if (n === null) e !== null && e.ref !== null && (t.flags |= 4194816);
		else {
			if (typeof n != "function" && typeof n != "object") throw Error(i(284));
			(e === null || e.ref !== n) && (t.flags |= 4194816);
		}
	}
	function oc(e, t, n, r, i) {
		return Xi(t), n = to(e, t, n, r, void 0, i), r = ao(), e !== null && !Qs ? (oo(e, t, i), bc(e, t, i)) : (R && r && Di(t), t.flags |= 1, $s(e, t, n, i), t.child);
	}
	function sc(e, t, n, r, i, a) {
		return Xi(t), t.updateQueue = null, n = ro(t, r, n, i), no(e), r = ao(), e !== null && !Qs ? (oo(e, t, a), bc(e, t, a)) : (R && r && Di(t), t.flags |= 1, $s(e, t, n, a), t.child);
	}
	function cc(e, t, n, r, i) {
		if (Xi(t), t.stateNode === null) {
			var a = oi, o = n.contextType;
			typeof o == "object" && o && (a = Zi(o)), a = new n(r, a), t.memoizedState = a.state !== null && a.state !== void 0 ? a.state : null, a.updater = Ls, t.stateNode = a, a._reactInternals = t, a = t.stateNode, a.props = r, a.state = t.memoizedState, a.refs = {}, Oa(t), o = n.contextType, a.context = typeof o == "object" && o ? Zi(o) : oi, a.state = t.memoizedState, o = n.getDerivedStateFromProps, typeof o == "function" && (Is(t, n, o, r), a.state = t.memoizedState), typeof n.getDerivedStateFromProps == "function" || typeof a.getSnapshotBeforeUpdate == "function" || typeof a.UNSAFE_componentWillMount != "function" && typeof a.componentWillMount != "function" || (o = a.state, typeof a.componentWillMount == "function" && a.componentWillMount(), typeof a.UNSAFE_componentWillMount == "function" && a.UNSAFE_componentWillMount(), o !== a.state && Ls.enqueueReplaceState(a, a.state, null), Ia(t, r, a, i), Fa(), a.state = t.memoizedState), typeof a.componentDidMount == "function" && (t.flags |= 4194308), r = !0;
		} else if (e === null) {
			a = t.stateNode;
			var s = t.memoizedProps, c = Bs(n, s);
			a.props = c;
			var l = a.context, u = n.contextType;
			o = oi, typeof u == "object" && u && (o = Zi(u));
			var d = n.getDerivedStateFromProps;
			u = typeof d == "function" || typeof a.getSnapshotBeforeUpdate == "function", s = t.pendingProps !== s, u || typeof a.UNSAFE_componentWillReceiveProps != "function" && typeof a.componentWillReceiveProps != "function" || (s || l !== o) && zs(t, a, r, o), Da = !1;
			var f = t.memoizedState;
			a.state = f, Ia(t, r, a, i), Fa(), l = t.memoizedState, s || f !== l || Da ? (typeof d == "function" && (Is(t, n, d, r), l = t.memoizedState), (c = Da || Rs(t, n, c, r, f, l, o)) ? (u || typeof a.UNSAFE_componentWillMount != "function" && typeof a.componentWillMount != "function" || (typeof a.componentWillMount == "function" && a.componentWillMount(), typeof a.UNSAFE_componentWillMount == "function" && a.UNSAFE_componentWillMount()), typeof a.componentDidMount == "function" && (t.flags |= 4194308)) : (typeof a.componentDidMount == "function" && (t.flags |= 4194308), t.memoizedProps = r, t.memoizedState = l), a.props = r, a.state = l, a.context = o, r = c) : (typeof a.componentDidMount == "function" && (t.flags |= 4194308), r = !1);
		} else {
			a = t.stateNode, ka(e, t), o = t.memoizedProps, u = Bs(n, o), a.props = u, d = t.pendingProps, f = a.context, l = n.contextType, c = oi, typeof l == "object" && l && (c = Zi(l)), s = n.getDerivedStateFromProps, (l = typeof s == "function" || typeof a.getSnapshotBeforeUpdate == "function") || typeof a.UNSAFE_componentWillReceiveProps != "function" && typeof a.componentWillReceiveProps != "function" || (o !== d || f !== c) && zs(t, a, r, c), Da = !1, f = t.memoizedState, a.state = f, Ia(t, r, a, i), Fa();
			var p = t.memoizedState;
			o !== d || f !== p || Da || e !== null && e.dependencies !== null && Yi(e.dependencies) ? (typeof s == "function" && (Is(t, n, s, r), p = t.memoizedState), (u = Da || Rs(t, n, u, r, f, p, c) || e !== null && e.dependencies !== null && Yi(e.dependencies)) ? (l || typeof a.UNSAFE_componentWillUpdate != "function" && typeof a.componentWillUpdate != "function" || (typeof a.componentWillUpdate == "function" && a.componentWillUpdate(r, p, c), typeof a.UNSAFE_componentWillUpdate == "function" && a.UNSAFE_componentWillUpdate(r, p, c)), typeof a.componentDidUpdate == "function" && (t.flags |= 4), typeof a.getSnapshotBeforeUpdate == "function" && (t.flags |= 1024)) : (typeof a.componentDidUpdate != "function" || o === e.memoizedProps && f === e.memoizedState || (t.flags |= 4), typeof a.getSnapshotBeforeUpdate != "function" || o === e.memoizedProps && f === e.memoizedState || (t.flags |= 1024), t.memoizedProps = r, t.memoizedState = p), a.props = r, a.state = p, a.context = c, r = u) : (typeof a.componentDidUpdate != "function" || o === e.memoizedProps && f === e.memoizedState || (t.flags |= 4), typeof a.getSnapshotBeforeUpdate != "function" || o === e.memoizedProps && f === e.memoizedState || (t.flags |= 1024), r = !1);
		}
		return a = r, ac(e, t), r = (t.flags & 128) != 0, a || r ? (a = t.stateNode, n = r && typeof n.getDerivedStateFromError != "function" ? null : a.render(), t.flags |= 1, e !== null && r ? (t.child = Es(t, e.child, null, i), t.child = Es(t, null, n, i)) : $s(e, t, n, i), t.memoizedState = a.state, e = t.child) : e = bc(e, t, i), e;
	}
	function lc(e, t, n, r) {
		return Ri(), t.flags |= 256, $s(e, t, n, r), t.child;
	}
	var uc = {
		dehydrated: null,
		treeContext: null,
		retryLane: 0,
		hydrationErrors: null
	};
	function dc(e) {
		return {
			baseLanes: e,
			cachePool: ga()
		};
	}
	function fc(e, t, n) {
		return e = e === null ? 0 : e.childLanes & ~n, t && (e |= Ll), e;
	}
	function pc(e, t, n) {
		var r = t.pendingProps, a = !1, o = (t.flags & 128) != 0, s;
		if ((s = o) || (s = e !== null && e.memoizedState === null ? !1 : (Ps.current & 2) != 0), s && (a = !0, t.flags &= -129), s = (t.flags & 32) != 0, t.flags &= -33, e === null) {
			if (R) {
				if (a ? As(t) : Ms(t), R) {
					var c = Ai, l;
					if (l = c) {
						c: {
							for (l = c, c = Mi; l.nodeType !== 8;) {
								if (!c) {
									c = null;
									break c;
								}
								if (l = Wd(l.nextSibling), l === null) {
									c = null;
									break c;
								}
							}
							c = l;
						}
						c === null ? l = !1 : (t.memoizedState = {
							dehydrated: c,
							treeContext: Si === null ? null : {
								id: Ci,
								overflow: wi
							},
							retryLane: 536870912,
							hydrationErrors: null
						}, l = ci(18, null, null, 0), l.stateNode = c, l.return = t, t.child = l, ki = t, Ai = null, l = !0);
					}
					l || Pi(t);
				}
				if (c = t.memoizedState, c !== null && (c = c.dehydrated, c !== null)) return Hd(c) ? t.lanes = 32 : t.lanes = 536870912, null;
				Ns(t);
			}
			return c = r.children, r = r.fallback, a ? (Ms(t), a = t.mode, c = hc({
				mode: "hidden",
				children: c
			}, a), r = pi(r, a, n, null), c.return = t, r.return = t, c.sibling = r, t.child = c, a = t.child, a.memoizedState = dc(n), a.childLanes = fc(e, s, n), t.memoizedState = uc, r) : (As(t), mc(t, c));
		}
		if (l = e.memoizedState, l !== null && (c = l.dehydrated, c !== null)) {
			if (o) t.flags & 256 ? (As(t), t.flags &= -257, t = gc(e, t, n)) : t.memoizedState === null ? (Ms(t), a = r.fallback, c = t.mode, r = hc({
				mode: "visible",
				children: r.children
			}, c), a = pi(a, c, n, null), a.flags |= 2, r.return = t, a.return = t, r.sibling = a, t.child = r, Es(t, e.child, null, n), r = t.child, r.memoizedState = dc(n), r.childLanes = fc(e, s, n), t.memoizedState = uc, t = a) : (Ms(t), t.child = e.child, t.flags |= 128, t = null);
			else if (As(t), Hd(c)) {
				if (s = c.nextSibling && c.nextSibling.dataset, s) var u = s.dgst;
				s = u, r = Error(i(419)), r.stack = "", r.digest = s, Bi({
					value: r,
					source: null,
					stack: null
				}), t = gc(e, t, n);
			} else if (Qs || Ji(e, t, n, !1), s = (n & e.childLanes) !== 0, Qs || s) {
				if (s = q, s !== null && (r = n & -n, r = r & 42 ? 1 : Qe(r), r = (r & (s.suspendedLanes | n)) === 0 ? r : 0, r !== 0 && r !== l.retryLane)) throw l.retryLane = r, ri(e, r), ru(s, e, r), Zs;
				c.data === "$?" || mu(), t = gc(e, t, n);
			} else c.data === "$?" ? (t.flags |= 192, t.child = e.child, t = null) : (e = l.treeContext, Ai = Wd(c.nextSibling), ki = t, R = !0, ji = null, Mi = !1, e !== null && (bi[xi++] = Ci, bi[xi++] = wi, bi[xi++] = Si, Ci = e.id, wi = e.overflow, Si = t), t = mc(t, r.children), t.flags |= 4096);
			return t;
		}
		return a ? (Ms(t), a = r.fallback, c = t.mode, l = e.child, u = l.sibling, r = ui(l, {
			mode: "hidden",
			children: r.children
		}), r.subtreeFlags = l.subtreeFlags & 65011712, u === null ? (a = pi(a, c, n, null), a.flags |= 2) : a = ui(u, a), a.return = t, r.return = t, r.sibling = a, t.child = r, r = a, a = t.child, c = e.child.memoizedState, c === null ? c = dc(n) : (l = c.cachePool, l === null ? l = ga() : (u = z._currentValue, l = l.parent === u ? l : {
			parent: u,
			pool: u
		}), c = {
			baseLanes: c.baseLanes | n,
			cachePool: l
		}), a.memoizedState = c, a.childLanes = fc(e, s, n), t.memoizedState = uc, r) : (As(t), n = e.child, e = n.sibling, n = ui(n, {
			mode: "visible",
			children: r.children
		}), n.return = t, n.sibling = null, e !== null && (s = t.deletions, s === null ? (t.deletions = [e], t.flags |= 16) : s.push(e)), t.child = n, t.memoizedState = null, n);
	}
	function mc(e, t) {
		return t = hc({
			mode: "visible",
			children: t
		}, e.mode), t.return = e, e.child = t;
	}
	function hc(e, t) {
		return e = ci(22, e, null, t), e.lanes = 0, e.stateNode = {
			_visibility: 1,
			_pendingMarkers: null,
			_retryCache: null,
			_transitions: null
		}, e;
	}
	function gc(e, t, n) {
		return Es(t, e.child, null, n), e = mc(t, t.pendingProps.children), e.flags |= 2, t.memoizedState = null, e;
	}
	function _c(e, t, n) {
		e.lanes |= t;
		var r = e.alternate;
		r !== null && (r.lanes |= t), Ki(e.return, t, n);
	}
	function vc(e, t, n, r, i) {
		var a = e.memoizedState;
		a === null ? e.memoizedState = {
			isBackwards: t,
			rendering: null,
			renderingStartTime: 0,
			last: r,
			tail: n,
			tailMode: i
		} : (a.isBackwards = t, a.rendering = null, a.renderingStartTime = 0, a.last = r, a.tail = n, a.tailMode = i);
	}
	function yc(e, t, n) {
		var r = t.pendingProps, i = r.revealOrder, a = r.tail;
		if ($s(e, t, r.children, n), r = Ps.current, r & 2) r = r & 1 | 2, t.flags |= 128;
		else {
			if (e !== null && e.flags & 128) a: for (e = t.child; e !== null;) {
				if (e.tag === 13) e.memoizedState !== null && _c(e, n, t);
				else if (e.tag === 19) _c(e, n, t);
				else if (e.child !== null) {
					e.child.return = e, e = e.child;
					continue;
				}
				if (e === t) break a;
				for (; e.sibling === null;) {
					if (e.return === null || e.return === t) break a;
					e = e.return;
				}
				e.sibling.return = e.return, e = e.sibling;
			}
			r &= 1;
		}
		switch (N(Ps, r), i) {
			case "forwards":
				for (n = t.child, i = null; n !== null;) e = n.alternate, e !== null && Fs(e) === null && (i = n), n = n.sibling;
				n = i, n === null ? (i = t.child, t.child = null) : (i = n.sibling, n.sibling = null), vc(t, !1, i, n, a);
				break;
			case "backwards":
				for (n = null, i = t.child, t.child = null; i !== null;) {
					if (e = i.alternate, e !== null && Fs(e) === null) {
						t.child = i;
						break;
					}
					e = i.sibling, i.sibling = n, n = i, i = e;
				}
				vc(t, !0, n, null, a);
				break;
			case "together":
				vc(t, !1, null, null, void 0);
				break;
			default: t.memoizedState = null;
		}
		return t.child;
	}
	function bc(e, t, n) {
		if (e !== null && (t.dependencies = e.dependencies), Pl |= t.lanes, (n & t.childLanes) === 0) if (e !== null) {
			if (Ji(e, t, n, !1), (n & t.childLanes) === 0) return null;
		} else return null;
		if (e !== null && t.child !== e.child) throw Error(i(153));
		if (t.child !== null) {
			for (e = t.child, n = ui(e, e.pendingProps), t.child = n, n.return = t; e.sibling !== null;) e = e.sibling, n = n.sibling = ui(e, e.pendingProps), n.return = t;
			n.sibling = null;
		}
		return t.child;
	}
	function xc(e, t) {
		return (e.lanes & t) === 0 ? (e = e.dependencies, !!(e !== null && Yi(e))) : !0;
	}
	function Sc(e, t, n) {
		switch (t.tag) {
			case 3:
				me(t, t.stateNode.containerInfo), Wi(t, z, e.memoizedState.cache), Ri();
				break;
			case 27:
			case 5:
				ge(t);
				break;
			case 4:
				me(t, t.stateNode.containerInfo);
				break;
			case 10:
				Wi(t, t.type, t.memoizedProps.value);
				break;
			case 13:
				var r = t.memoizedState;
				if (r !== null) return r.dehydrated === null ? (n & t.child.childLanes) === 0 ? (As(t), e = bc(e, t, n), e === null ? null : e.sibling) : pc(e, t, n) : (As(t), t.flags |= 128, null);
				As(t);
				break;
			case 19:
				var i = (e.flags & 128) != 0;
				if (r = (n & t.childLanes) !== 0, r ||= (Ji(e, t, n, !1), (n & t.childLanes) !== 0), i) {
					if (r) return yc(e, t, n);
					t.flags |= 128;
				}
				if (i = t.memoizedState, i !== null && (i.rendering = null, i.tail = null, i.lastEffect = null), N(Ps, Ps.current), r) break;
				return null;
			case 22:
			case 23: return t.lanes = 0, rc(e, t, n);
			case 24: Wi(t, z, e.memoizedState.cache);
		}
		return bc(e, t, n);
	}
	function Cc(e, t, n) {
		if (e !== null) if (e.memoizedProps !== t.pendingProps) Qs = !0;
		else {
			if (!xc(e, n) && !(t.flags & 128)) return Qs = !1, Sc(e, t, n);
			Qs = !!(e.flags & 131072);
		}
		else Qs = !1, R && t.flags & 1048576 && Ei(t, yi, t.index);
		switch (t.lanes = 0, t.tag) {
			case 16:
				a: {
					e = t.pendingProps;
					var r = t.elementType, a = r._init;
					if (r = a(r._payload), t.type = r, typeof r == "function") li(r) ? (e = Bs(r, e), t.tag = 1, t = cc(null, t, r, e, n)) : (t.tag = 0, t = oc(null, t, r, e, n));
					else {
						if (r != null) {
							if (a = r.$$typeof, a === te) {
								t.tag = 11, t = ec(null, t, r, e, n);
								break a;
							} else if (a === ne) {
								t.tag = 14, t = tc(null, t, r, e, n);
								break a;
							}
						}
						throw t = ae(r) || r, Error(i(306, t, ""));
					}
				}
				return t;
			case 0: return oc(e, t, t.type, t.pendingProps, n);
			case 1: return r = t.type, a = Bs(r, t.pendingProps), cc(e, t, r, a, n);
			case 3:
				a: {
					if (me(t, t.stateNode.containerInfo), e === null) throw Error(i(387));
					r = t.pendingProps;
					var o = t.memoizedState;
					a = o.element, ka(e, t), Ia(t, r, null, n);
					var s = t.memoizedState;
					if (r = s.cache, Wi(t, z, r), r !== o.cache && qi(t, [z], n, !0), Fa(), r = s.element, o.isDehydrated) if (o = {
						element: r,
						isDehydrated: !1,
						cache: s.cache
					}, t.updateQueue.baseState = o, t.memoizedState = o, t.flags & 256) {
						t = lc(e, t, r, n);
						break a;
					} else if (r !== a) {
						a = Xr(Error(i(424)), t), Bi(a), t = lc(e, t, r, n);
						break a;
					} else {
						switch (e = t.stateNode.containerInfo, e.nodeType) {
							case 9:
								e = e.body;
								break;
							default: e = e.nodeName === "HTML" ? e.ownerDocument.body : e;
						}
						for (Ai = Wd(e.firstChild), ki = t, R = !0, ji = null, Mi = !0, n = Ds(t, null, r, n), t.child = n; n;) n.flags = n.flags & -3 | 4096, n = n.sibling;
					}
					else {
						if (Ri(), r === a) {
							t = bc(e, t, n);
							break a;
						}
						$s(e, t, r, n);
					}
					t = t.child;
				}
				return t;
			case 26: return ac(e, t), e === null ? (n = df(t.type, null, t.pendingProps, null)) ? t.memoizedState = n : R || (n = t.type, e = t.pendingProps, r = Ed(fe.current).createElement(n), r[rt] = t, r[it] = e, Sd(r, n, e), gt(r), t.stateNode = r) : t.memoizedState = df(t.type, e.memoizedProps, t.pendingProps, e.memoizedState), null;
			case 27: return ge(t), e === null && R && (r = t.stateNode = qd(t.type, t.pendingProps, fe.current), ki = t, Mi = !0, a = Ai, Ld(t.type) ? (Gd = a, Ai = Wd(r.firstChild)) : Ai = a), $s(e, t, t.pendingProps.children, n), ac(e, t), e === null && (t.flags |= 4194304), t.child;
			case 5: return e === null && R && ((a = r = Ai) && (r = Bd(r, t.type, t.pendingProps, Mi), r === null ? a = !1 : (t.stateNode = r, ki = t, Ai = Wd(r.firstChild), Mi = !1, a = !0)), a || Pi(t)), ge(t), a = t.type, o = t.pendingProps, s = e === null ? null : e.memoizedProps, r = o.children, kd(a, o) ? r = null : s !== null && kd(a, s) && (t.flags |= 32), t.memoizedState !== null && (a = to(e, t, io, null, null, n), Ff._currentValue = a), ac(e, t), $s(e, t, r, n), t.child;
			case 6: return e === null && R && ((e = n = Ai) && (n = Vd(n, t.pendingProps, Mi), n === null ? e = !1 : (t.stateNode = n, ki = t, Ai = null, e = !0)), e || Pi(t)), null;
			case 13: return pc(e, t, n);
			case 4: return me(t, t.stateNode.containerInfo), r = t.pendingProps, e === null ? t.child = Es(t, null, r, n) : $s(e, t, r, n), t.child;
			case 11: return ec(e, t, t.type, t.pendingProps, n);
			case 7: return $s(e, t, t.pendingProps, n), t.child;
			case 8: return $s(e, t, t.pendingProps.children, n), t.child;
			case 12: return $s(e, t, t.pendingProps.children, n), t.child;
			case 10: return r = t.pendingProps, Wi(t, t.type, r.value), $s(e, t, r.children, n), t.child;
			case 9: return a = t.type._context, r = t.pendingProps.children, Xi(t), a = Zi(a), r = r(a), t.flags |= 1, $s(e, t, r, n), t.child;
			case 14: return tc(e, t, t.type, t.pendingProps, n);
			case 15: return nc(e, t, t.type, t.pendingProps, n);
			case 19: return yc(e, t, n);
			case 31: return r = t.pendingProps, n = t.mode, r = {
				mode: r.mode,
				children: r.children
			}, e === null ? (n = hc(r, n), n.ref = t.ref, t.child = n, n.return = t, t = n) : (n = ui(e.child, r), n.ref = t.ref, t.child = n, n.return = t, t = n), t;
			case 22: return rc(e, t, n);
			case 24: return Xi(t), r = Zi(z), e === null ? (a = ma(), a === null && (a = q, o = ra(), a.pooledCache = o, o.refCount++, o !== null && (a.pooledCacheLanes |= n), a = o), t.memoizedState = {
				parent: r,
				cache: a
			}, Oa(t), Wi(t, z, a)) : ((e.lanes & n) !== 0 && (ka(e, t), Ia(t, null, null, n), Fa()), a = e.memoizedState, o = t.memoizedState, a.parent === r ? (r = o.cache, Wi(t, z, r), r !== a.cache && qi(t, [z], n, !0)) : (a = {
				parent: r,
				cache: r
			}, t.memoizedState = a, t.lanes === 0 && (t.memoizedState = t.updateQueue.baseState = a), Wi(t, z, r))), $s(e, t, t.pendingProps.children, n), t.child;
			case 29: throw t.pendingProps;
		}
		throw Error(i(156, t.tag));
	}
	function wc(e) {
		e.flags |= 4;
	}
	function Tc(e, t) {
		if (t.type !== "stylesheet" || t.state.loading & 4) e.flags &= -16777217;
		else if (e.flags |= 16777216, !Ef(t)) {
			if (t = Os.current, t !== null && ((Y & 4194048) === Y ? ks !== null : (Y & 62914560) !== Y && !(Y & 536870912) || t !== ks)) throw wa = ba, va;
			e.flags |= 8192;
		}
	}
	function Ec(e, t) {
		t !== null && (e.flags |= 4), e.flags & 16384 && (t = e.tag === 22 ? 536870912 : Ke(), e.lanes |= t, Rl |= t);
	}
	function Dc(e, t) {
		if (!R) switch (e.tailMode) {
			case "hidden":
				t = e.tail;
				for (var n = null; t !== null;) t.alternate !== null && (n = t), t = t.sibling;
				n === null ? e.tail = null : n.sibling = null;
				break;
			case "collapsed":
				n = e.tail;
				for (var r = null; n !== null;) n.alternate !== null && (r = n), n = n.sibling;
				r === null ? t || e.tail === null ? e.tail = null : e.tail.sibling = null : r.sibling = null;
		}
	}
	function W(e) {
		var t = e.alternate !== null && e.alternate.child === e.child, n = 0, r = 0;
		if (t) for (var i = e.child; i !== null;) n |= i.lanes | i.childLanes, r |= i.subtreeFlags & 65011712, r |= i.flags & 65011712, i.return = e, i = i.sibling;
		else for (i = e.child; i !== null;) n |= i.lanes | i.childLanes, r |= i.subtreeFlags, r |= i.flags, i.return = e, i = i.sibling;
		return e.subtreeFlags |= r, e.childLanes = n, t;
	}
	function Oc(e, t, n) {
		var r = t.pendingProps;
		switch (Oi(t), t.tag) {
			case 31:
			case 16:
			case 15:
			case 0:
			case 11:
			case 7:
			case 8:
			case 12:
			case 9:
			case 14: return W(t), null;
			case 1: return W(t), null;
			case 3: return n = t.stateNode, r = null, e !== null && (r = e.memoizedState.cache), t.memoizedState.cache !== r && (t.flags |= 2048), Gi(z), he(), n.pendingContext && (n.context = n.pendingContext, n.pendingContext = null), (e === null || e.child === null) && (Li(t) ? wc(t) : e === null || e.memoizedState.isDehydrated && !(t.flags & 256) || (t.flags |= 1024, zi())), W(t), null;
			case 26: return n = t.memoizedState, e === null ? (wc(t), n === null ? (W(t), t.flags &= -16777217) : (W(t), Tc(t, n))) : n ? n === e.memoizedState ? (W(t), t.flags &= -16777217) : (wc(t), W(t), Tc(t, n)) : (e.memoizedProps !== r && wc(t), W(t), t.flags &= -16777217), null;
			case 27:
				_e(t), n = fe.current;
				var a = t.type;
				if (e !== null && t.stateNode != null) e.memoizedProps !== r && wc(t);
				else {
					if (!r) {
						if (t.stateNode === null) throw Error(i(166));
						return W(t), null;
					}
					e = ue.current, Li(t) ? Fi(t, e) : (e = qd(a, r, n), t.stateNode = e, wc(t));
				}
				return W(t), null;
			case 5:
				if (_e(t), n = t.type, e !== null && t.stateNode != null) e.memoizedProps !== r && wc(t);
				else {
					if (!r) {
						if (t.stateNode === null) throw Error(i(166));
						return W(t), null;
					}
					if (e = ue.current, Li(t)) Fi(t, e);
					else {
						switch (a = Ed(fe.current), e) {
							case 1:
								e = a.createElementNS("http://www.w3.org/2000/svg", n);
								break;
							case 2:
								e = a.createElementNS("http://www.w3.org/1998/Math/MathML", n);
								break;
							default: switch (n) {
								case "svg":
									e = a.createElementNS("http://www.w3.org/2000/svg", n);
									break;
								case "math":
									e = a.createElementNS("http://www.w3.org/1998/Math/MathML", n);
									break;
								case "script":
									e = a.createElement("div"), e.innerHTML = "<script><\/script>", e = e.removeChild(e.firstChild);
									break;
								case "select":
									e = typeof r.is == "string" ? a.createElement("select", { is: r.is }) : a.createElement("select"), r.multiple ? e.multiple = !0 : r.size && (e.size = r.size);
									break;
								default: e = typeof r.is == "string" ? a.createElement(n, { is: r.is }) : a.createElement(n);
							}
						}
						e[rt] = t, e[it] = r;
						a: for (a = t.child; a !== null;) {
							if (a.tag === 5 || a.tag === 6) e.appendChild(a.stateNode);
							else if (a.tag !== 4 && a.tag !== 27 && a.child !== null) {
								a.child.return = a, a = a.child;
								continue;
							}
							if (a === t) break a;
							for (; a.sibling === null;) {
								if (a.return === null || a.return === t) break a;
								a = a.return;
							}
							a.sibling.return = a.return, a = a.sibling;
						}
						t.stateNode = e;
						a: switch (Sd(e, n, r), n) {
							case "button":
							case "input":
							case "select":
							case "textarea":
								e = !!r.autoFocus;
								break a;
							case "img":
								e = !0;
								break a;
							default: e = !1;
						}
						e && wc(t);
					}
				}
				return W(t), t.flags &= -16777217, null;
			case 6:
				if (e && t.stateNode != null) e.memoizedProps !== r && wc(t);
				else {
					if (typeof r != "string" && t.stateNode === null) throw Error(i(166));
					if (e = fe.current, Li(t)) {
						if (e = t.stateNode, n = t.memoizedProps, r = null, a = ki, a !== null) switch (a.tag) {
							case 27:
							case 5: r = a.memoizedProps;
						}
						e[rt] = t, e = !!(e.nodeValue === n || r !== null && !0 === r.suppressHydrationWarning || yd(e.nodeValue, n)), e || Pi(t);
					} else e = Ed(e).createTextNode(r), e[rt] = t, t.stateNode = e;
				}
				return W(t), null;
			case 13:
				if (r = t.memoizedState, e === null || e.memoizedState !== null && e.memoizedState.dehydrated !== null) {
					if (a = Li(t), r !== null && r.dehydrated !== null) {
						if (e === null) {
							if (!a) throw Error(i(318));
							if (a = t.memoizedState, a = a === null ? null : a.dehydrated, !a) throw Error(i(317));
							a[rt] = t;
						} else Ri(), !(t.flags & 128) && (t.memoizedState = null), t.flags |= 4;
						W(t), a = !1;
					} else a = zi(), e !== null && e.memoizedState !== null && (e.memoizedState.hydrationErrors = a), a = !0;
					if (!a) return t.flags & 256 ? (Ns(t), t) : (Ns(t), null);
				}
				if (Ns(t), t.flags & 128) return t.lanes = n, t;
				if (n = r !== null, e = e !== null && e.memoizedState !== null, n) {
					r = t.child, a = null, r.alternate !== null && r.alternate.memoizedState !== null && r.alternate.memoizedState.cachePool !== null && (a = r.alternate.memoizedState.cachePool.pool);
					var o = null;
					r.memoizedState !== null && r.memoizedState.cachePool !== null && (o = r.memoizedState.cachePool.pool), o !== a && (r.flags |= 2048);
				}
				return n !== e && n && (t.child.flags |= 8192), Ec(t, t.updateQueue), W(t), null;
			case 4: return he(), e === null && ld(t.stateNode.containerInfo), W(t), null;
			case 10: return Gi(t.type), W(t), null;
			case 19:
				if (le(Ps), a = t.memoizedState, a === null) return W(t), null;
				if (r = (t.flags & 128) != 0, o = a.rendering, o === null) if (r) Dc(a, !1);
				else {
					if (Nl !== 0 || e !== null && e.flags & 128) for (e = t.child; e !== null;) {
						if (o = Fs(e), o !== null) {
							for (t.flags |= 128, Dc(a, !1), e = o.updateQueue, t.updateQueue = e, Ec(t, e), t.subtreeFlags = 0, e = n, n = t.child; n !== null;) di(n, e), n = n.sibling;
							return N(Ps, Ps.current & 1 | 2), t.child;
						}
						e = e.sibling;
					}
					a.tail !== null && Ce() > Ul && (t.flags |= 128, r = !0, Dc(a, !1), t.lanes = 4194304);
				}
				else {
					if (!r) if (e = Fs(o), e !== null) {
						if (t.flags |= 128, r = !0, e = e.updateQueue, t.updateQueue = e, Ec(t, e), Dc(a, !0), a.tail === null && a.tailMode === "hidden" && !o.alternate && !R) return W(t), null;
					} else 2 * Ce() - a.renderingStartTime > Ul && n !== 536870912 && (t.flags |= 128, r = !0, Dc(a, !1), t.lanes = 4194304);
					a.isBackwards ? (o.sibling = t.child, t.child = o) : (e = a.last, e === null ? t.child = o : e.sibling = o, a.last = o);
				}
				return a.tail === null ? (W(t), null) : (t = a.tail, a.rendering = t, a.tail = t.sibling, a.renderingStartTime = Ce(), t.sibling = null, e = Ps.current, N(Ps, r ? e & 1 | 2 : e & 1), t);
			case 22:
			case 23: return Ns(t), Ua(), r = t.memoizedState !== null, e === null ? r && (t.flags |= 8192) : e.memoizedState !== null !== r && (t.flags |= 8192), r ? n & 536870912 && !(t.flags & 128) && (W(t), t.subtreeFlags & 6 && (t.flags |= 8192)) : W(t), n = t.updateQueue, n !== null && Ec(t, n.retryQueue), n = null, e !== null && e.memoizedState !== null && e.memoizedState.cachePool !== null && (n = e.memoizedState.cachePool.pool), r = null, t.memoizedState !== null && t.memoizedState.cachePool !== null && (r = t.memoizedState.cachePool.pool), r !== n && (t.flags |= 2048), e !== null && le(pa), null;
			case 24: return n = null, e !== null && (n = e.memoizedState.cache), t.memoizedState.cache !== n && (t.flags |= 2048), Gi(z), W(t), null;
			case 25: return null;
			case 30: return null;
		}
		throw Error(i(156, t.tag));
	}
	function kc(e, t) {
		switch (Oi(t), t.tag) {
			case 1: return e = t.flags, e & 65536 ? (t.flags = e & -65537 | 128, t) : null;
			case 3: return Gi(z), he(), e = t.flags, e & 65536 && !(e & 128) ? (t.flags = e & -65537 | 128, t) : null;
			case 26:
			case 27:
			case 5: return _e(t), null;
			case 13:
				if (Ns(t), e = t.memoizedState, e !== null && e.dehydrated !== null) {
					if (t.alternate === null) throw Error(i(340));
					Ri();
				}
				return e = t.flags, e & 65536 ? (t.flags = e & -65537 | 128, t) : null;
			case 19: return le(Ps), null;
			case 4: return he(), null;
			case 10: return Gi(t.type), null;
			case 22:
			case 23: return Ns(t), Ua(), e !== null && le(pa), e = t.flags, e & 65536 ? (t.flags = e & -65537 | 128, t) : null;
			case 24: return Gi(z), null;
			case 25: return null;
			default: return null;
		}
	}
	function Ac(e, t) {
		switch (Oi(t), t.tag) {
			case 3:
				Gi(z), he();
				break;
			case 26:
			case 27:
			case 5:
				_e(t);
				break;
			case 4:
				he();
				break;
			case 13:
				Ns(t);
				break;
			case 19:
				le(Ps);
				break;
			case 10:
				Gi(t.type);
				break;
			case 22:
			case 23:
				Ns(t), Ua(), e !== null && le(pa);
				break;
			case 24: Gi(z);
		}
	}
	function jc(e, t) {
		try {
			var n = t.updateQueue, r = n === null ? null : n.lastEffect;
			if (r !== null) {
				var i = r.next;
				n = i;
				do {
					if ((n.tag & e) === e) {
						r = void 0;
						var a = n.create, o = n.inst;
						r = a(), o.destroy = r;
					}
					n = n.next;
				} while (n !== i);
			}
		} catch (e) {
			Z(t, t.return, e);
		}
	}
	function Mc(e, t, n) {
		try {
			var r = t.updateQueue, i = r === null ? null : r.lastEffect;
			if (i !== null) {
				var a = i.next;
				r = a;
				do {
					if ((r.tag & e) === e) {
						var o = r.inst, s = o.destroy;
						if (s !== void 0) {
							o.destroy = void 0, i = t;
							var c = n, l = s;
							try {
								l();
							} catch (e) {
								Z(i, c, e);
							}
						}
					}
					r = r.next;
				} while (r !== a);
			}
		} catch (e) {
			Z(t, t.return, e);
		}
	}
	function Nc(e) {
		var t = e.updateQueue;
		if (t !== null) {
			var n = e.stateNode;
			try {
				Ra(t, n);
			} catch (t) {
				Z(e, e.return, t);
			}
		}
	}
	function Pc(e, t, n) {
		n.props = Bs(e.type, e.memoizedProps), n.state = e.memoizedState;
		try {
			n.componentWillUnmount();
		} catch (n) {
			Z(e, t, n);
		}
	}
	function Fc(e, t) {
		try {
			var n = e.ref;
			if (n !== null) {
				switch (e.tag) {
					case 26:
					case 27:
					case 5:
						var r = e.stateNode;
						break;
					case 30:
						r = e.stateNode;
						break;
					default: r = e.stateNode;
				}
				typeof n == "function" ? e.refCleanup = n(r) : n.current = r;
			}
		} catch (n) {
			Z(e, t, n);
		}
	}
	function Ic(e, t) {
		var n = e.ref, r = e.refCleanup;
		if (n !== null) if (typeof r == "function") try {
			r();
		} catch (n) {
			Z(e, t, n);
		} finally {
			e.refCleanup = null, e = e.alternate, e != null && (e.refCleanup = null);
		}
		else if (typeof n == "function") try {
			n(null);
		} catch (n) {
			Z(e, t, n);
		}
		else n.current = null;
	}
	function Lc(e) {
		var t = e.type, n = e.memoizedProps, r = e.stateNode;
		try {
			a: switch (t) {
				case "button":
				case "input":
				case "select":
				case "textarea":
					n.autoFocus && r.focus();
					break a;
				case "img": n.src ? r.src = n.src : n.srcSet && (r.srcset = n.srcSet);
			}
		} catch (t) {
			Z(e, e.return, t);
		}
	}
	function Rc(e, t, n) {
		try {
			var r = e.stateNode;
			Cd(r, e.type, n, t), r[it] = t;
		} catch (t) {
			Z(e, e.return, t);
		}
	}
	function zc(e) {
		return e.tag === 5 || e.tag === 3 || e.tag === 26 || e.tag === 27 && Ld(e.type) || e.tag === 4;
	}
	function Bc(e) {
		a: for (;;) {
			for (; e.sibling === null;) {
				if (e.return === null || zc(e.return)) return null;
				e = e.return;
			}
			for (e.sibling.return = e.return, e = e.sibling; e.tag !== 5 && e.tag !== 6 && e.tag !== 18;) {
				if (e.tag === 27 && Ld(e.type) || e.flags & 2 || e.child === null || e.tag === 4) continue a;
				e.child.return = e, e = e.child;
			}
			if (!(e.flags & 2)) return e.stateNode;
		}
	}
	function Vc(e, t, n) {
		var r = e.tag;
		if (r === 5 || r === 6) e = e.stateNode, t ? (n.nodeType === 9 ? n.body : n.nodeName === "HTML" ? n.ownerDocument.body : n).insertBefore(e, t) : (t = n.nodeType === 9 ? n.body : n.nodeName === "HTML" ? n.ownerDocument.body : n, t.appendChild(e), n = n._reactRootContainer, n != null || t.onclick !== null || (t.onclick = bd));
		else if (r !== 4 && (r === 27 && Ld(e.type) && (n = e.stateNode, t = null), e = e.child, e !== null)) for (Vc(e, t, n), e = e.sibling; e !== null;) Vc(e, t, n), e = e.sibling;
	}
	function Hc(e, t, n) {
		var r = e.tag;
		if (r === 5 || r === 6) e = e.stateNode, t ? n.insertBefore(e, t) : n.appendChild(e);
		else if (r !== 4 && (r === 27 && Ld(e.type) && (n = e.stateNode), e = e.child, e !== null)) for (Hc(e, t, n), e = e.sibling; e !== null;) Hc(e, t, n), e = e.sibling;
	}
	function Uc(e) {
		var t = e.stateNode, n = e.memoizedProps;
		try {
			for (var r = e.type, i = t.attributes; i.length;) t.removeAttributeNode(i[0]);
			Sd(t, r, n), t[rt] = e, t[it] = n;
		} catch (t) {
			Z(e, e.return, t);
		}
	}
	var Wc = !1, Gc = !1, Kc = !1, qc = typeof WeakSet == "function" ? WeakSet : Set, Jc = null;
	function Yc(e, t) {
		if (e = e.containerInfo, wd = Uf, e = Er(e), Dr(e)) {
			if ("selectionStart" in e) var n = {
				start: e.selectionStart,
				end: e.selectionEnd
			};
			else a: {
				n = (n = e.ownerDocument) && n.defaultView || window;
				var r = n.getSelection && n.getSelection();
				if (r && r.rangeCount !== 0) {
					n = r.anchorNode;
					var a = r.anchorOffset, o = r.focusNode;
					r = r.focusOffset;
					try {
						n.nodeType, o.nodeType;
					} catch {
						n = null;
						break a;
					}
					var s = 0, c = -1, l = -1, u = 0, d = 0, f = e, p = null;
					b: for (;;) {
						for (var m; f !== n || a !== 0 && f.nodeType !== 3 || (c = s + a), f !== o || r !== 0 && f.nodeType !== 3 || (l = s + r), f.nodeType === 3 && (s += f.nodeValue.length), (m = f.firstChild) !== null;) p = f, f = m;
						for (;;) {
							if (f === e) break b;
							if (p === n && ++u === a && (c = s), p === o && ++d === r && (l = s), (m = f.nextSibling) !== null) break;
							f = p, p = f.parentNode;
						}
						f = m;
					}
					n = c === -1 || l === -1 ? null : {
						start: c,
						end: l
					};
				} else n = null;
			}
			n ||= {
				start: 0,
				end: 0
			};
		} else n = null;
		for (Td = {
			focusedElem: e,
			selectionRange: n
		}, Uf = !1, Jc = t; Jc !== null;) if (t = Jc, e = t.child, t.subtreeFlags & 1024 && e !== null) e.return = t, Jc = e;
		else for (; Jc !== null;) {
			switch (t = Jc, o = t.alternate, e = t.flags, t.tag) {
				case 0: break;
				case 11:
				case 15: break;
				case 1:
					if (e & 1024 && o !== null) {
						e = void 0, n = t, a = o.memoizedProps, o = o.memoizedState, r = n.stateNode;
						try {
							var h = Bs(n.type, a, n.elementType === n.type);
							e = r.getSnapshotBeforeUpdate(h, o), r.__reactInternalSnapshotBeforeUpdate = e;
						} catch (e) {
							Z(n, n.return, e);
						}
					}
					break;
				case 3:
					if (e & 1024) {
						if (e = t.stateNode.containerInfo, n = e.nodeType, n === 9) zd(e);
						else if (n === 1) switch (e.nodeName) {
							case "HEAD":
							case "HTML":
							case "BODY":
								zd(e);
								break;
							default: e.textContent = "";
						}
					}
					break;
				case 5:
				case 26:
				case 27:
				case 6:
				case 4:
				case 17: break;
				default: if (e & 1024) throw Error(i(163));
			}
			if (e = t.sibling, e !== null) {
				e.return = t.return, Jc = e;
				break;
			}
			Jc = t.return;
		}
	}
	function Xc(e, t, n) {
		var r = n.flags;
		switch (n.tag) {
			case 0:
			case 11:
			case 15:
				ll(e, n), r & 4 && jc(5, n);
				break;
			case 1:
				if (ll(e, n), r & 4) if (e = n.stateNode, t === null) try {
					e.componentDidMount();
				} catch (e) {
					Z(n, n.return, e);
				}
				else {
					var i = Bs(n.type, t.memoizedProps);
					t = t.memoizedState;
					try {
						e.componentDidUpdate(i, t, e.__reactInternalSnapshotBeforeUpdate);
					} catch (e) {
						Z(n, n.return, e);
					}
				}
				r & 64 && Nc(n), r & 512 && Fc(n, n.return);
				break;
			case 3:
				if (ll(e, n), r & 64 && (e = n.updateQueue, e !== null)) {
					if (t = null, n.child !== null) switch (n.child.tag) {
						case 27:
						case 5:
							t = n.child.stateNode;
							break;
						case 1: t = n.child.stateNode;
					}
					try {
						Ra(e, t);
					} catch (e) {
						Z(n, n.return, e);
					}
				}
				break;
			case 27: t === null && r & 4 && Uc(n);
			case 26:
			case 5:
				ll(e, n), t === null && r & 4 && Lc(n), r & 512 && Fc(n, n.return);
				break;
			case 12:
				ll(e, n);
				break;
			case 13:
				ll(e, n), r & 4 && tl(e, n), r & 64 && (e = n.memoizedState, e !== null && (e = e.dehydrated, e !== null && (n = Fu.bind(null, n), Ud(e, n))));
				break;
			case 22:
				if (r = n.memoizedState !== null || Wc, !r) {
					t = t !== null && t.memoizedState !== null || Gc, i = Wc;
					var a = Gc;
					Wc = r, (Gc = t) && !a ? dl(e, n, (n.subtreeFlags & 8772) != 0) : ll(e, n), Wc = i, Gc = a;
				}
				break;
			case 30: break;
			default: ll(e, n);
		}
	}
	function Zc(e) {
		var t = e.alternate;
		t !== null && (e.alternate = null, Zc(t)), e.child = null, e.deletions = null, e.sibling = null, e.tag === 5 && (t = e.stateNode, t !== null && dt(t)), e.stateNode = null, e.return = null, e.dependencies = null, e.memoizedProps = null, e.memoizedState = null, e.pendingProps = null, e.stateNode = null, e.updateQueue = null;
	}
	var G = null, Qc = !1;
	function $c(e, t, n) {
		for (n = n.child; n !== null;) el(e, t, n), n = n.sibling;
	}
	function el(e, t, n) {
		if (Ne && typeof Ne.onCommitFiberUnmount == "function") try {
			Ne.onCommitFiberUnmount(Me, n);
		} catch {}
		switch (n.tag) {
			case 26:
				Gc || Ic(n, t), $c(e, t, n), n.memoizedState ? n.memoizedState.count-- : n.stateNode && (n = n.stateNode, n.parentNode.removeChild(n));
				break;
			case 27:
				Gc || Ic(n, t);
				var r = G, i = Qc;
				Ld(n.type) && (G = n.stateNode, Qc = !1), $c(e, t, n), Jd(n.stateNode), G = r, Qc = i;
				break;
			case 5: Gc || Ic(n, t);
			case 6:
				if (r = G, i = Qc, G = null, $c(e, t, n), G = r, Qc = i, G !== null) if (Qc) try {
					(G.nodeType === 9 ? G.body : G.nodeName === "HTML" ? G.ownerDocument.body : G).removeChild(n.stateNode);
				} catch (e) {
					Z(n, t, e);
				}
				else try {
					G.removeChild(n.stateNode);
				} catch (e) {
					Z(n, t, e);
				}
				break;
			case 18:
				G !== null && (Qc ? (e = G, Rd(e.nodeType === 9 ? e.body : e.nodeName === "HTML" ? e.ownerDocument.body : e, n.stateNode), hp(e)) : Rd(G, n.stateNode));
				break;
			case 4:
				r = G, i = Qc, G = n.stateNode.containerInfo, Qc = !0, $c(e, t, n), G = r, Qc = i;
				break;
			case 0:
			case 11:
			case 14:
			case 15:
				Gc || Mc(2, n, t), Gc || Mc(4, n, t), $c(e, t, n);
				break;
			case 1:
				Gc || (Ic(n, t), r = n.stateNode, typeof r.componentWillUnmount == "function" && Pc(n, t, r)), $c(e, t, n);
				break;
			case 21:
				$c(e, t, n);
				break;
			case 22:
				Gc = (r = Gc) || n.memoizedState !== null, $c(e, t, n), Gc = r;
				break;
			default: $c(e, t, n);
		}
	}
	function tl(e, t) {
		if (t.memoizedState === null && (e = t.alternate, e !== null && (e = e.memoizedState, e !== null && (e = e.dehydrated, e !== null)))) try {
			hp(e);
		} catch (e) {
			Z(t, t.return, e);
		}
	}
	function nl(e) {
		switch (e.tag) {
			case 13:
			case 19:
				var t = e.stateNode;
				return t === null && (t = e.stateNode = new qc()), t;
			case 22: return e = e.stateNode, t = e._retryCache, t === null && (t = e._retryCache = new qc()), t;
			default: throw Error(i(435, e.tag));
		}
	}
	function rl(e, t) {
		var n = nl(e);
		t.forEach(function(t) {
			var r = Iu.bind(null, e, t);
			n.has(t) || (n.add(t), t.then(r, r));
		});
	}
	function il(e, t) {
		var n = t.deletions;
		if (n !== null) for (var r = 0; r < n.length; r++) {
			var a = n[r], o = e, s = t, c = s;
			a: for (; c !== null;) {
				switch (c.tag) {
					case 27:
						if (Ld(c.type)) {
							G = c.stateNode, Qc = !1;
							break a;
						}
						break;
					case 5:
						G = c.stateNode, Qc = !1;
						break a;
					case 3:
					case 4:
						G = c.stateNode.containerInfo, Qc = !0;
						break a;
				}
				c = c.return;
			}
			if (G === null) throw Error(i(160));
			el(o, s, a), G = null, Qc = !1, o = a.alternate, o !== null && (o.return = null), a.return = null;
		}
		if (t.subtreeFlags & 13878) for (t = t.child; t !== null;) ol(t, e), t = t.sibling;
	}
	var al = null;
	function ol(e, t) {
		var n = e.alternate, r = e.flags;
		switch (e.tag) {
			case 0:
			case 11:
			case 14:
			case 15:
				il(t, e), sl(e), r & 4 && (Mc(3, e, e.return), jc(3, e), Mc(5, e, e.return));
				break;
			case 1:
				il(t, e), sl(e), r & 512 && (Gc || n === null || Ic(n, n.return)), r & 64 && Wc && (e = e.updateQueue, e !== null && (r = e.callbacks, r !== null && (n = e.shared.hiddenCallbacks, e.shared.hiddenCallbacks = n === null ? r : n.concat(r))));
				break;
			case 26:
				var a = al;
				if (il(t, e), sl(e), r & 512 && (Gc || n === null || Ic(n, n.return)), r & 4) {
					var o = n === null ? null : n.memoizedState;
					if (r = e.memoizedState, n === null) if (r === null) if (e.stateNode === null) {
						a: {
							r = e.type, n = e.memoizedProps, a = a.ownerDocument || a;
							b: switch (r) {
								case "title":
									o = a.getElementsByTagName("title")[0], (!o || o[ut] || o[rt] || o.namespaceURI === "http://www.w3.org/2000/svg" || o.hasAttribute("itemprop")) && (o = a.createElement(r), a.head.insertBefore(o, a.querySelector("head > title"))), Sd(o, r, n), o[rt] = e, gt(o), r = o;
									break a;
								case "link":
									var s = Cf("link", "href", a).get(r + (n.href || ""));
									if (s) {
										for (var c = 0; c < s.length; c++) if (o = s[c], o.getAttribute("href") === (n.href == null || n.href === "" ? null : n.href) && o.getAttribute("rel") === (n.rel == null ? null : n.rel) && o.getAttribute("title") === (n.title == null ? null : n.title) && o.getAttribute("crossorigin") === (n.crossOrigin == null ? null : n.crossOrigin)) {
											s.splice(c, 1);
											break b;
										}
									}
									o = a.createElement(r), Sd(o, r, n), a.head.appendChild(o);
									break;
								case "meta":
									if (s = Cf("meta", "content", a).get(r + (n.content || ""))) {
										for (c = 0; c < s.length; c++) if (o = s[c], o.getAttribute("content") === (n.content == null ? null : "" + n.content) && o.getAttribute("name") === (n.name == null ? null : n.name) && o.getAttribute("property") === (n.property == null ? null : n.property) && o.getAttribute("http-equiv") === (n.httpEquiv == null ? null : n.httpEquiv) && o.getAttribute("charset") === (n.charSet == null ? null : n.charSet)) {
											s.splice(c, 1);
											break b;
										}
									}
									o = a.createElement(r), Sd(o, r, n), a.head.appendChild(o);
									break;
								default: throw Error(i(468, r));
							}
							o[rt] = e, gt(o), r = o;
						}
						e.stateNode = r;
					} else wf(a, e.type, e.stateNode);
					else e.stateNode = vf(a, r, e.memoizedProps);
					else o === r ? r === null && e.stateNode !== null && Rc(e, e.memoizedProps, n.memoizedProps) : (o === null ? n.stateNode !== null && (n = n.stateNode, n.parentNode.removeChild(n)) : o.count--, r === null ? wf(a, e.type, e.stateNode) : vf(a, r, e.memoizedProps));
				}
				break;
			case 27:
				il(t, e), sl(e), r & 512 && (Gc || n === null || Ic(n, n.return)), n !== null && r & 4 && Rc(e, e.memoizedProps, n.memoizedProps);
				break;
			case 5:
				if (il(t, e), sl(e), r & 512 && (Gc || n === null || Ic(n, n.return)), e.flags & 32) {
					a = e.stateNode;
					try {
						Gt(a, "");
					} catch (t) {
						Z(e, e.return, t);
					}
				}
				r & 4 && e.stateNode != null && (a = e.memoizedProps, Rc(e, a, n === null ? a : n.memoizedProps)), r & 1024 && (Kc = !0);
				break;
			case 6:
				if (il(t, e), sl(e), r & 4) {
					if (e.stateNode === null) throw Error(i(162));
					r = e.memoizedProps, n = e.stateNode;
					try {
						n.nodeValue = r;
					} catch (t) {
						Z(e, e.return, t);
					}
				}
				break;
			case 3:
				if (Sf = null, a = al, al = Zd(t.containerInfo), il(t, e), al = a, sl(e), r & 4 && n !== null && n.memoizedState.isDehydrated) try {
					hp(t.containerInfo);
				} catch (t) {
					Z(e, e.return, t);
				}
				Kc && (Kc = !1, cl(e));
				break;
			case 4:
				r = al, al = Zd(e.stateNode.containerInfo), il(t, e), sl(e), al = r;
				break;
			case 12:
				il(t, e), sl(e);
				break;
			case 13:
				il(t, e), sl(e), e.child.flags & 8192 && e.memoizedState !== null != (n !== null && n.memoizedState !== null) && (Hl = Ce()), r & 4 && (r = e.updateQueue, r !== null && (e.updateQueue = null, rl(e, r)));
				break;
			case 22:
				a = e.memoizedState !== null;
				var l = n !== null && n.memoizedState !== null, u = Wc, d = Gc;
				if (Wc = u || a, Gc = d || l, il(t, e), Gc = d, Wc = u, sl(e), r & 8192) a: for (t = e.stateNode, t._visibility = a ? t._visibility & -2 : t._visibility | 1, a && (n === null || l || Wc || Gc || ul(e)), n = null, t = e;;) {
					if (t.tag === 5 || t.tag === 26) {
						if (n === null) {
							l = n = t;
							try {
								if (o = l.stateNode, a) s = o.style, typeof s.setProperty == "function" ? s.setProperty("display", "none", "important") : s.display = "none";
								else {
									c = l.stateNode;
									var f = l.memoizedProps.style, p = f != null && f.hasOwnProperty("display") ? f.display : null;
									c.style.display = p == null || typeof p == "boolean" ? "" : ("" + p).trim();
								}
							} catch (e) {
								Z(l, l.return, e);
							}
						}
					} else if (t.tag === 6) {
						if (n === null) {
							l = t;
							try {
								l.stateNode.nodeValue = a ? "" : l.memoizedProps;
							} catch (e) {
								Z(l, l.return, e);
							}
						}
					} else if ((t.tag !== 22 && t.tag !== 23 || t.memoizedState === null || t === e) && t.child !== null) {
						t.child.return = t, t = t.child;
						continue;
					}
					if (t === e) break a;
					for (; t.sibling === null;) {
						if (t.return === null || t.return === e) break a;
						n === t && (n = null), t = t.return;
					}
					n === t && (n = null), t.sibling.return = t.return, t = t.sibling;
				}
				r & 4 && (r = e.updateQueue, r !== null && (n = r.retryQueue, n !== null && (r.retryQueue = null, rl(e, n))));
				break;
			case 19:
				il(t, e), sl(e), r & 4 && (r = e.updateQueue, r !== null && (e.updateQueue = null, rl(e, r)));
				break;
			case 30: break;
			case 21: break;
			default: il(t, e), sl(e);
		}
	}
	function sl(e) {
		var t = e.flags;
		if (t & 2) {
			try {
				for (var n, r = e.return; r !== null;) {
					if (zc(r)) {
						n = r;
						break;
					}
					r = r.return;
				}
				if (n == null) throw Error(i(160));
				switch (n.tag) {
					case 27:
						var a = n.stateNode;
						Hc(e, Bc(e), a);
						break;
					case 5:
						var o = n.stateNode;
						n.flags & 32 && (Gt(o, ""), n.flags &= -33), Hc(e, Bc(e), o);
						break;
					case 3:
					case 4:
						var s = n.stateNode.containerInfo;
						Vc(e, Bc(e), s);
						break;
					default: throw Error(i(161));
				}
			} catch (t) {
				Z(e, e.return, t);
			}
			e.flags &= -3;
		}
		t & 4096 && (e.flags &= -4097);
	}
	function cl(e) {
		if (e.subtreeFlags & 1024) for (e = e.child; e !== null;) {
			var t = e;
			cl(t), t.tag === 5 && t.flags & 1024 && t.stateNode.reset(), e = e.sibling;
		}
	}
	function ll(e, t) {
		if (t.subtreeFlags & 8772) for (t = t.child; t !== null;) Xc(e, t.alternate, t), t = t.sibling;
	}
	function ul(e) {
		for (e = e.child; e !== null;) {
			var t = e;
			switch (t.tag) {
				case 0:
				case 11:
				case 14:
				case 15:
					Mc(4, t, t.return), ul(t);
					break;
				case 1:
					Ic(t, t.return);
					var n = t.stateNode;
					typeof n.componentWillUnmount == "function" && Pc(t, t.return, n), ul(t);
					break;
				case 27: Jd(t.stateNode);
				case 26:
				case 5:
					Ic(t, t.return), ul(t);
					break;
				case 22:
					t.memoizedState === null && ul(t);
					break;
				case 30:
					ul(t);
					break;
				default: ul(t);
			}
			e = e.sibling;
		}
	}
	function dl(e, t, n) {
		for (n &&= (t.subtreeFlags & 8772) != 0, t = t.child; t !== null;) {
			var r = t.alternate, i = e, a = t, o = a.flags;
			switch (a.tag) {
				case 0:
				case 11:
				case 15:
					dl(i, a, n), jc(4, a);
					break;
				case 1:
					if (dl(i, a, n), r = a, i = r.stateNode, typeof i.componentDidMount == "function") try {
						i.componentDidMount();
					} catch (e) {
						Z(r, r.return, e);
					}
					if (r = a, i = r.updateQueue, i !== null) {
						var s = r.stateNode;
						try {
							var c = i.shared.hiddenCallbacks;
							if (c !== null) for (i.shared.hiddenCallbacks = null, i = 0; i < c.length; i++) La(c[i], s);
						} catch (e) {
							Z(r, r.return, e);
						}
					}
					n && o & 64 && Nc(a), Fc(a, a.return);
					break;
				case 27: Uc(a);
				case 26:
				case 5:
					dl(i, a, n), n && r === null && o & 4 && Lc(a), Fc(a, a.return);
					break;
				case 12:
					dl(i, a, n);
					break;
				case 13:
					dl(i, a, n), n && o & 4 && tl(i, a);
					break;
				case 22:
					a.memoizedState === null && dl(i, a, n), Fc(a, a.return);
					break;
				case 30: break;
				default: dl(i, a, n);
			}
			t = t.sibling;
		}
	}
	function fl(e, t) {
		var n = null;
		e !== null && e.memoizedState !== null && e.memoizedState.cachePool !== null && (n = e.memoizedState.cachePool.pool), e = null, t.memoizedState !== null && t.memoizedState.cachePool !== null && (e = t.memoizedState.cachePool.pool), e !== n && (e != null && e.refCount++, n != null && ia(n));
	}
	function pl(e, t) {
		e = null, t.alternate !== null && (e = t.alternate.memoizedState.cache), t = t.memoizedState.cache, t !== e && (t.refCount++, e != null && ia(e));
	}
	function ml(e, t, n, r) {
		if (t.subtreeFlags & 10256) for (t = t.child; t !== null;) hl(e, t, n, r), t = t.sibling;
	}
	function hl(e, t, n, r) {
		var i = t.flags;
		switch (t.tag) {
			case 0:
			case 11:
			case 15:
				ml(e, t, n, r), i & 2048 && jc(9, t);
				break;
			case 1:
				ml(e, t, n, r);
				break;
			case 3:
				ml(e, t, n, r), i & 2048 && (e = null, t.alternate !== null && (e = t.alternate.memoizedState.cache), t = t.memoizedState.cache, t !== e && (t.refCount++, e != null && ia(e)));
				break;
			case 12:
				if (i & 2048) {
					ml(e, t, n, r), e = t.stateNode;
					try {
						var a = t.memoizedProps, o = a.id, s = a.onPostCommit;
						typeof s == "function" && s(o, t.alternate === null ? "mount" : "update", e.passiveEffectDuration, -0);
					} catch (e) {
						Z(t, t.return, e);
					}
				} else ml(e, t, n, r);
				break;
			case 13:
				ml(e, t, n, r);
				break;
			case 23: break;
			case 22:
				a = t.stateNode, o = t.alternate, t.memoizedState === null ? a._visibility & 2 ? ml(e, t, n, r) : (a._visibility |= 2, gl(e, t, n, r, (t.subtreeFlags & 10256) != 0)) : a._visibility & 2 ? ml(e, t, n, r) : _l(e, t), i & 2048 && fl(o, t);
				break;
			case 24:
				ml(e, t, n, r), i & 2048 && pl(t.alternate, t);
				break;
			default: ml(e, t, n, r);
		}
	}
	function gl(e, t, n, r, i) {
		for (i &&= (t.subtreeFlags & 10256) != 0, t = t.child; t !== null;) {
			var a = e, o = t, s = n, c = r, l = o.flags;
			switch (o.tag) {
				case 0:
				case 11:
				case 15:
					gl(a, o, s, c, i), jc(8, o);
					break;
				case 23: break;
				case 22:
					var u = o.stateNode;
					o.memoizedState === null ? (u._visibility |= 2, gl(a, o, s, c, i)) : u._visibility & 2 ? gl(a, o, s, c, i) : _l(a, o), i && l & 2048 && fl(o.alternate, o);
					break;
				case 24:
					gl(a, o, s, c, i), i && l & 2048 && pl(o.alternate, o);
					break;
				default: gl(a, o, s, c, i);
			}
			t = t.sibling;
		}
	}
	function _l(e, t) {
		if (t.subtreeFlags & 10256) for (t = t.child; t !== null;) {
			var n = e, r = t, i = r.flags;
			switch (r.tag) {
				case 22:
					_l(n, r), i & 2048 && fl(r.alternate, r);
					break;
				case 24:
					_l(n, r), i & 2048 && pl(r.alternate, r);
					break;
				default: _l(n, r);
			}
			t = t.sibling;
		}
	}
	var vl = 8192;
	function yl(e) {
		if (e.subtreeFlags & vl) for (e = e.child; e !== null;) bl(e), e = e.sibling;
	}
	function bl(e) {
		switch (e.tag) {
			case 26:
				yl(e), e.flags & vl && e.memoizedState !== null && kf(al, e.memoizedState, e.memoizedProps);
				break;
			case 5:
				yl(e);
				break;
			case 3:
			case 4:
				var t = al;
				al = Zd(e.stateNode.containerInfo), yl(e), al = t;
				break;
			case 22:
				e.memoizedState === null && (t = e.alternate, t !== null && t.memoizedState !== null ? (t = vl, vl = 16777216, yl(e), vl = t) : yl(e));
				break;
			default: yl(e);
		}
	}
	function xl(e) {
		var t = e.alternate;
		if (t !== null && (e = t.child, e !== null)) {
			t.child = null;
			do
				t = e.sibling, e.sibling = null, e = t;
			while (e !== null);
		}
	}
	function Sl(e) {
		var t = e.deletions;
		if (e.flags & 16) {
			if (t !== null) for (var n = 0; n < t.length; n++) {
				var r = t[n];
				Jc = r, Tl(r, e);
			}
			xl(e);
		}
		if (e.subtreeFlags & 10256) for (e = e.child; e !== null;) Cl(e), e = e.sibling;
	}
	function Cl(e) {
		switch (e.tag) {
			case 0:
			case 11:
			case 15:
				Sl(e), e.flags & 2048 && Mc(9, e, e.return);
				break;
			case 3:
				Sl(e);
				break;
			case 12:
				Sl(e);
				break;
			case 22:
				var t = e.stateNode;
				e.memoizedState !== null && t._visibility & 2 && (e.return === null || e.return.tag !== 13) ? (t._visibility &= -3, wl(e)) : Sl(e);
				break;
			default: Sl(e);
		}
	}
	function wl(e) {
		var t = e.deletions;
		if (e.flags & 16) {
			if (t !== null) for (var n = 0; n < t.length; n++) {
				var r = t[n];
				Jc = r, Tl(r, e);
			}
			xl(e);
		}
		for (e = e.child; e !== null;) {
			switch (t = e, t.tag) {
				case 0:
				case 11:
				case 15:
					Mc(8, t, t.return), wl(t);
					break;
				case 22:
					n = t.stateNode, n._visibility & 2 && (n._visibility &= -3, wl(t));
					break;
				default: wl(t);
			}
			e = e.sibling;
		}
	}
	function Tl(e, t) {
		for (; Jc !== null;) {
			var n = Jc;
			switch (n.tag) {
				case 0:
				case 11:
				case 15:
					Mc(8, n, t);
					break;
				case 23:
				case 22:
					if (n.memoizedState !== null && n.memoizedState.cachePool !== null) {
						var r = n.memoizedState.cachePool.pool;
						r != null && r.refCount++;
					}
					break;
				case 24: ia(n.memoizedState.cache);
			}
			if (r = n.child, r !== null) r.return = n, Jc = r;
			else a: for (n = e; Jc !== null;) {
				r = Jc;
				var i = r.sibling, a = r.return;
				if (Zc(r), r === n) {
					Jc = null;
					break a;
				}
				if (i !== null) {
					i.return = a, Jc = i;
					break a;
				}
				Jc = a;
			}
		}
	}
	var El = { getCacheForType: function(e) {
		var t = Zi(z), n = t.data.get(e);
		return n === void 0 && (n = e(), t.data.set(e, n)), n;
	} }, Dl = typeof WeakMap == "function" ? WeakMap : Map, K = 0, q = null, J = null, Y = 0, X = 0, Ol = null, kl = !1, Al = !1, jl = !1, Ml = 0, Nl = 0, Pl = 0, Fl = 0, Il = 0, Ll = 0, Rl = 0, zl = null, Bl = null, Vl = !1, Hl = 0, Ul = Infinity, Wl = null, Gl = null, Kl = 0, ql = null, Jl = null, Yl = 0, Xl = 0, Zl = null, Ql = null, $l = 0, eu = null;
	function tu() {
		if (K & 2 && Y !== 0) return Y & -Y;
		if (A.T !== null) {
			var e = sa;
			return e === 0 ? Qu() : e;
		}
		return et();
	}
	function nu() {
		Ll === 0 && (Ll = !(Y & 536870912) || R ? Ge() : 536870912);
		var e = Os.current;
		return e !== null && (e.flags |= 32), Ll;
	}
	function ru(e, t, n) {
		(e === q && (X === 2 || X === 9) || e.cancelPendingCommit !== null) && (uu(e, 0), su(e, Y, Ll, !1)), Je(e, n), (!(K & 2) || e !== q) && (e === q && (!(K & 2) && (Fl |= n), Nl === 4 && su(e, Y, Ll, !1)), Wu(e));
	}
	function iu(e, t, n) {
		if (K & 6) throw Error(i(327));
		var r = !n && (t & 124) == 0 && (t & e.expiredLanes) === 0 || Ue(e, t), a = r ? _u(e, t) : hu(e, t, !0), o = r;
		do {
			if (a === 0) {
				Al && !r && su(e, t, 0, !1);
				break;
			} else {
				if (n = e.current.alternate, o && !ou(n)) {
					a = hu(e, t, !1), o = !1;
					continue;
				}
				if (a === 2) {
					if (o = t, e.errorRecoveryDisabledLanes & o) var s = 0;
					else s = e.pendingLanes & -536870913, s = s === 0 ? s & 536870912 ? 536870912 : 0 : s;
					if (s !== 0) {
						t = s;
						a: {
							var c = e;
							a = zl;
							var l = c.current.memoizedState.isDehydrated;
							if (l && (uu(c, s).flags |= 256), s = hu(c, s, !1), s !== 2) {
								if (jl && !l) {
									c.errorRecoveryDisabledLanes |= o, Fl |= o, a = 4;
									break a;
								}
								o = Bl, Bl = a, o !== null && (Bl === null ? Bl = o : Bl.push.apply(Bl, o));
							}
							a = s;
						}
						if (o = !1, a !== 2) continue;
					}
				}
				if (a === 1) {
					uu(e, 0), su(e, t, 0, !0);
					break;
				}
				a: {
					switch (r = e, o = a, o) {
						case 0:
						case 1: throw Error(i(345));
						case 4: if ((t & 4194048) !== t) break;
						case 6:
							su(r, t, Ll, !kl);
							break a;
						case 2:
							Bl = null;
							break;
						case 3:
						case 5: break;
						default: throw Error(i(329));
					}
					if ((t & 62914560) === t && (a = Hl + 300 - Ce(), 10 < a)) {
						if (su(r, t, Ll, !kl), He(r, 0, !0) !== 0) break a;
						r.timeoutHandle = Md(au.bind(null, r, n, Bl, Wl, Vl, t, Ll, Fl, Rl, kl, o, 2, -0, 0), a);
						break a;
					}
					au(r, n, Bl, Wl, Vl, t, Ll, Fl, Rl, kl, o, 0, -0, 0);
				}
			}
			break;
		} while (1);
		Wu(e);
	}
	function au(e, t, n, r, i, a, o, s, c, l, u, d, f, p) {
		if (e.timeoutHandle = -1, d = t.subtreeFlags, (d & 8192 || (d & 16785408) == 16785408) && (Df = {
			stylesheets: null,
			count: 0,
			unsuspend: Of
		}, bl(t), d = Af(), d !== null)) {
			e.cancelPendingCommit = d(wu.bind(null, e, t, a, n, r, i, o, s, c, u, 1, f, p)), su(e, a, o, !l);
			return;
		}
		wu(e, t, a, n, r, i, o, s, c);
	}
	function ou(e) {
		for (var t = e;;) {
			var n = t.tag;
			if ((n === 0 || n === 11 || n === 15) && t.flags & 16384 && (n = t.updateQueue, n !== null && (n = n.stores, n !== null))) for (var r = 0; r < n.length; r++) {
				var i = n[r], a = i.getSnapshot;
				i = i.value;
				try {
					if (!xr(a(), i)) return !1;
				} catch {
					return !1;
				}
			}
			if (n = t.child, t.subtreeFlags & 16384 && n !== null) n.return = t, t = n;
			else {
				if (t === e) break;
				for (; t.sibling === null;) {
					if (t.return === null || t.return === e) return !0;
					t = t.return;
				}
				t.sibling.return = t.return, t = t.sibling;
			}
		}
		return !0;
	}
	function su(e, t, n, r) {
		t &= ~Il, t &= ~Fl, e.suspendedLanes |= t, e.pingedLanes &= ~t, r && (e.warmLanes |= t), r = e.expirationTimes;
		for (var i = t; 0 < i;) {
			var a = 31 - Fe(i), o = 1 << a;
			r[a] = -1, i &= ~o;
		}
		n !== 0 && Xe(e, n, t);
	}
	function cu() {
		return K & 6 ? !0 : (Gu(0, !1), !1);
	}
	function lu() {
		if (J !== null) {
			if (X === 0) var e = J.return;
			else e = J, Ui = Hi = null, so(e), ys = null, bs = 0, e = J;
			for (; e !== null;) Ac(e.alternate, e), e = e.return;
			J = null;
		}
	}
	function uu(e, t) {
		var n = e.timeoutHandle;
		n !== -1 && (e.timeoutHandle = -1, Nd(n)), n = e.cancelPendingCommit, n !== null && (e.cancelPendingCommit = null, n()), lu(), q = e, J = n = ui(e.current, null), Y = t, X = 0, Ol = null, kl = !1, Al = Ue(e, t), jl = !1, Rl = Ll = Il = Fl = Pl = Nl = 0, Bl = zl = null, Vl = !1, t & 8 && (t |= t & 32);
		var r = e.entangledLanes;
		if (r !== 0) for (e = e.entanglements, r &= t; 0 < r;) {
			var i = 31 - Fe(r), a = 1 << i;
			t |= e[i], r &= ~a;
		}
		return Ml = t, ei(), n;
	}
	function du(e, t) {
		B = null, A.H = hs, t === _a || t === ya ? (t = Ta(), X = 3) : t === va ? (t = Ta(), X = 4) : X = t === Zs ? 8 : typeof t == "object" && t && typeof t.then == "function" ? 6 : 1, Ol = t, J === null && (Nl = 1, Gs(e, Xr(t, e.current)));
	}
	function fu() {
		var e = A.H;
		return A.H = hs, e === null ? hs : e;
	}
	function pu() {
		var e = A.A;
		return A.A = El, e;
	}
	function mu() {
		Nl = 4, kl || (Y & 4194048) !== Y && Os.current !== null || (Al = !0), !(Pl & 134217727) && !(Fl & 134217727) || q === null || su(q, Y, Ll, !1);
	}
	function hu(e, t, n) {
		var r = K;
		K |= 2;
		var i = fu(), a = pu();
		(q !== e || Y !== t) && (Wl = null, uu(e, t)), t = !1;
		var o = Nl;
		a: do
			try {
				if (X !== 0 && J !== null) {
					var s = J, c = Ol;
					switch (X) {
						case 8:
							lu(), o = 6;
							break a;
						case 3:
						case 2:
						case 9:
						case 6:
							Os.current === null && (t = !0);
							var l = X;
							if (X = 0, Ol = null, xu(e, s, c, l), n && Al) {
								o = 0;
								break a;
							}
							break;
						default: l = X, X = 0, Ol = null, xu(e, s, c, l);
					}
				}
				gu(), o = Nl;
				break;
			} catch (t) {
				du(e, t);
			}
		while (1);
		return t && e.shellSuspendCounter++, Ui = Hi = null, K = r, A.H = i, A.A = a, J === null && (q = null, Y = 0, ei()), o;
	}
	function gu() {
		for (; J !== null;) yu(J);
	}
	function _u(e, t) {
		var n = K;
		K |= 2;
		var r = fu(), a = pu();
		q !== e || Y !== t ? (Wl = null, Ul = Ce() + 500, uu(e, t)) : Al = Ue(e, t);
		a: do
			try {
				if (X !== 0 && J !== null) {
					t = J;
					var o = Ol;
					b: switch (X) {
						case 1:
							X = 0, Ol = null, xu(e, t, o, 1);
							break;
						case 2:
						case 9:
							if (xa(o)) {
								X = 0, Ol = null, bu(t);
								break;
							}
							t = function() {
								X !== 2 && X !== 9 || q !== e || (X = 7), Wu(e);
							}, o.then(t, t);
							break a;
						case 3:
							X = 7;
							break a;
						case 4:
							X = 5;
							break a;
						case 7:
							xa(o) ? (X = 0, Ol = null, bu(t)) : (X = 0, Ol = null, xu(e, t, o, 7));
							break;
						case 5:
							var s = null;
							switch (J.tag) {
								case 26: s = J.memoizedState;
								case 5:
								case 27:
									var c = J;
									if (!s || Ef(s)) {
										X = 0, Ol = null;
										var l = c.sibling;
										if (l !== null) J = l;
										else {
											var u = c.return;
											u === null ? J = null : (J = u, Su(u));
										}
										break b;
									}
							}
							X = 0, Ol = null, xu(e, t, o, 5);
							break;
						case 6:
							X = 0, Ol = null, xu(e, t, o, 6);
							break;
						case 8:
							lu(), Nl = 6;
							break a;
						default: throw Error(i(462));
					}
				}
				vu();
				break;
			} catch (t) {
				du(e, t);
			}
		while (1);
		return Ui = Hi = null, A.H = r, A.A = a, K = n, J === null ? (q = null, Y = 0, ei(), Nl) : 0;
	}
	function vu() {
		for (; J !== null && !xe();) yu(J);
	}
	function yu(e) {
		var t = Cc(e.alternate, e, Ml);
		e.memoizedProps = e.pendingProps, t === null ? Su(e) : J = t;
	}
	function bu(e) {
		var t = e, n = t.alternate;
		switch (t.tag) {
			case 15:
			case 0:
				t = sc(n, t, t.pendingProps, t.type, void 0, Y);
				break;
			case 11:
				t = sc(n, t, t.pendingProps, t.type.render, t.ref, Y);
				break;
			case 5: so(t);
			default: Ac(n, t), t = J = di(t, Ml), t = Cc(n, t, Ml);
		}
		e.memoizedProps = e.pendingProps, t === null ? Su(e) : J = t;
	}
	function xu(e, t, n, r) {
		Ui = Hi = null, so(t), ys = null, bs = 0;
		var i = t.return;
		try {
			if (Xs(e, i, t, n, Y)) {
				Nl = 1, Gs(e, Xr(n, e.current)), J = null;
				return;
			}
		} catch (t) {
			if (i !== null) throw J = i, t;
			Nl = 1, Gs(e, Xr(n, e.current)), J = null;
			return;
		}
		t.flags & 32768 ? (R || r === 1 ? e = !0 : Al || Y & 536870912 ? e = !1 : (kl = e = !0, (r === 2 || r === 9 || r === 3 || r === 6) && (r = Os.current, r !== null && r.tag === 13 && (r.flags |= 16384))), Cu(t, e)) : Su(t);
	}
	function Su(e) {
		var t = e;
		do {
			if (t.flags & 32768) {
				Cu(t, kl);
				return;
			}
			e = t.return;
			var n = Oc(t.alternate, t, Ml);
			if (n !== null) {
				J = n;
				return;
			}
			if (t = t.sibling, t !== null) {
				J = t;
				return;
			}
			J = t = e;
		} while (t !== null);
		Nl === 0 && (Nl = 5);
	}
	function Cu(e, t) {
		do {
			var n = kc(e.alternate, e);
			if (n !== null) {
				n.flags &= 32767, J = n;
				return;
			}
			if (n = e.return, n !== null && (n.flags |= 32768, n.subtreeFlags = 0, n.deletions = null), !t && (e = e.sibling, e !== null)) {
				J = e;
				return;
			}
			J = e = n;
		} while (e !== null);
		Nl = 6, J = null;
	}
	function wu(e, t, n, r, a, o, s, c, l) {
		e.cancelPendingCommit = null;
		do
			ku();
		while (Kl !== 0);
		if (K & 6) throw Error(i(327));
		if (t !== null) {
			if (t === e.current) throw Error(i(177));
			if (o = t.lanes | t.childLanes, o |= $r, Ye(e, n, o, s, c, l), e === q && (J = q = null, Y = 0), Jl = t, ql = e, Yl = n, Xl = o, Zl = a, Ql = r, t.subtreeFlags & 10256 || t.flags & 10256 ? (e.callbackNode = null, e.callbackPriority = 0, Lu(De, function() {
				return Au(!0), null;
			})) : (e.callbackNode = null, e.callbackPriority = 0), r = (t.flags & 13878) != 0, t.subtreeFlags & 13878 || r) {
				r = A.T, A.T = null, a = j.p, j.p = 2, s = K, K |= 4;
				try {
					Yc(e, t, n);
				} finally {
					K = s, j.p = a, A.T = r;
				}
			}
			Kl = 1, Tu(), Eu(), Du();
		}
	}
	function Tu() {
		if (Kl === 1) {
			Kl = 0;
			var e = ql, t = Jl, n = (t.flags & 13878) != 0;
			if (t.subtreeFlags & 13878 || n) {
				n = A.T, A.T = null;
				var r = j.p;
				j.p = 2;
				var i = K;
				K |= 4;
				try {
					ol(t, e);
					var a = Td, o = Er(e.containerInfo), s = a.focusedElem, c = a.selectionRange;
					if (o !== s && s && s.ownerDocument && Tr(s.ownerDocument.documentElement, s)) {
						if (c !== null && Dr(s)) {
							var l = c.start, u = c.end;
							if (u === void 0 && (u = l), "selectionStart" in s) s.selectionStart = l, s.selectionEnd = Math.min(u, s.value.length);
							else {
								var d = s.ownerDocument || document, f = d && d.defaultView || window;
								if (f.getSelection) {
									var p = f.getSelection(), m = s.textContent.length, h = Math.min(c.start, m), g = c.end === void 0 ? h : Math.min(c.end, m);
									!p.extend && h > g && (o = g, g = h, h = o);
									var _ = wr(s, h), v = wr(s, g);
									if (_ && v && (p.rangeCount !== 1 || p.anchorNode !== _.node || p.anchorOffset !== _.offset || p.focusNode !== v.node || p.focusOffset !== v.offset)) {
										var y = d.createRange();
										y.setStart(_.node, _.offset), p.removeAllRanges(), h > g ? (p.addRange(y), p.extend(v.node, v.offset)) : (y.setEnd(v.node, v.offset), p.addRange(y));
									}
								}
							}
						}
						for (d = [], p = s; p = p.parentNode;) p.nodeType === 1 && d.push({
							element: p,
							left: p.scrollLeft,
							top: p.scrollTop
						});
						for (typeof s.focus == "function" && s.focus(), s = 0; s < d.length; s++) {
							var b = d[s];
							b.element.scrollLeft = b.left, b.element.scrollTop = b.top;
						}
					}
					Uf = !!wd, Td = wd = null;
				} finally {
					K = i, j.p = r, A.T = n;
				}
			}
			e.current = t, Kl = 2;
		}
	}
	function Eu() {
		if (Kl === 2) {
			Kl = 0;
			var e = ql, t = Jl, n = (t.flags & 8772) != 0;
			if (t.subtreeFlags & 8772 || n) {
				n = A.T, A.T = null;
				var r = j.p;
				j.p = 2;
				var i = K;
				K |= 4;
				try {
					Xc(e, t.alternate, t);
				} finally {
					K = i, j.p = r, A.T = n;
				}
			}
			Kl = 3;
		}
	}
	function Du() {
		if (Kl === 4 || Kl === 3) {
			Kl = 0, Se();
			var e = ql, t = Jl, n = Yl, r = Ql;
			t.subtreeFlags & 10256 || t.flags & 10256 ? Kl = 5 : (Kl = 0, Jl = ql = null, Ou(e, e.pendingLanes));
			var i = e.pendingLanes;
			if (i === 0 && (Gl = null), $e(n), t = t.stateNode, Ne && typeof Ne.onCommitFiberRoot == "function") try {
				Ne.onCommitFiberRoot(Me, t, void 0, (t.current.flags & 128) == 128);
			} catch {}
			if (r !== null) {
				t = A.T, i = j.p, j.p = 2, A.T = null;
				try {
					for (var a = e.onRecoverableError, o = 0; o < r.length; o++) {
						var s = r[o];
						a(s.value, { componentStack: s.stack });
					}
				} finally {
					A.T = t, j.p = i;
				}
			}
			Yl & 3 && ku(), Wu(e), i = e.pendingLanes, n & 4194090 && i & 42 ? e === eu ? $l++ : ($l = 0, eu = e) : $l = 0, Gu(0, !1);
		}
	}
	function Ou(e, t) {
		(e.pooledCacheLanes &= t) === 0 && (t = e.pooledCache, t != null && (e.pooledCache = null, ia(t)));
	}
	function ku(e) {
		return Tu(), Eu(), Du(), Au(e);
	}
	function Au() {
		if (Kl !== 5) return !1;
		var e = ql, t = Xl;
		Xl = 0;
		var n = $e(Yl), r = A.T, a = j.p;
		try {
			j.p = 32 > n ? 32 : n, A.T = null, n = Zl, Zl = null;
			var o = ql, s = Yl;
			if (Kl = 0, Jl = ql = null, Yl = 0, K & 6) throw Error(i(331));
			var c = K;
			if (K |= 4, Cl(o.current), hl(o, o.current, s, n), K = c, Gu(0, !1), Ne && typeof Ne.onPostCommitFiberRoot == "function") try {
				Ne.onPostCommitFiberRoot(Me, o);
			} catch {}
			return !0;
		} finally {
			j.p = a, A.T = r, Ou(e, t);
		}
	}
	function ju(e, t, n) {
		t = Xr(n, t), t = qs(e.stateNode, t, 2), e = ja(e, t, 2), e !== null && (Je(e, 2), Wu(e));
	}
	function Z(e, t, n) {
		if (e.tag === 3) ju(e, e, n);
		else for (; t !== null;) {
			if (t.tag === 3) {
				ju(t, e, n);
				break;
			} else if (t.tag === 1) {
				var r = t.stateNode;
				if (typeof t.type.getDerivedStateFromError == "function" || typeof r.componentDidCatch == "function" && (Gl === null || !Gl.has(r))) {
					e = Xr(n, e), n = Js(2), r = ja(t, n, 2), r !== null && (Ys(n, r, t, e), Je(r, 2), Wu(r));
					break;
				}
			}
			t = t.return;
		}
	}
	function Mu(e, t, n) {
		var r = e.pingCache;
		if (r === null) {
			r = e.pingCache = new Dl();
			var i = /* @__PURE__ */ new Set();
			r.set(t, i);
		} else i = r.get(t), i === void 0 && (i = /* @__PURE__ */ new Set(), r.set(t, i));
		i.has(n) || (jl = !0, i.add(n), e = Nu.bind(null, e, t, n), t.then(e, e));
	}
	function Nu(e, t, n) {
		var r = e.pingCache;
		r !== null && r.delete(t), e.pingedLanes |= e.suspendedLanes & n, e.warmLanes &= ~n, q === e && (Y & n) === n && (Nl === 4 || Nl === 3 && (Y & 62914560) === Y && 300 > Ce() - Hl ? !(K & 2) && uu(e, 0) : Il |= n, Rl === Y && (Rl = 0)), Wu(e);
	}
	function Pu(e, t) {
		t === 0 && (t = Ke()), e = ri(e, t), e !== null && (Je(e, t), Wu(e));
	}
	function Fu(e) {
		var t = e.memoizedState, n = 0;
		t !== null && (n = t.retryLane), Pu(e, n);
	}
	function Iu(e, t) {
		var n = 0;
		switch (e.tag) {
			case 13:
				var r = e.stateNode, a = e.memoizedState;
				a !== null && (n = a.retryLane);
				break;
			case 19:
				r = e.stateNode;
				break;
			case 22:
				r = e.stateNode._retryCache;
				break;
			default: throw Error(i(314));
		}
		r !== null && r.delete(t), Pu(e, n);
	}
	function Lu(e, t) {
		return ye(e, t);
	}
	var Ru = null, zu = null, Bu = !1, Vu = !1, Hu = !1, Uu = 0;
	function Wu(e) {
		e !== zu && e.next === null && (zu === null ? Ru = zu = e : zu = zu.next = e), Vu = !0, Bu || (Bu = !0, Zu());
	}
	function Gu(e, t) {
		if (!Hu && Vu) {
			Hu = !0;
			do
				for (var n = !1, r = Ru; r !== null;) {
					if (!t) if (e !== 0) {
						var i = r.pendingLanes;
						if (i === 0) var a = 0;
						else {
							var o = r.suspendedLanes, s = r.pingedLanes;
							a = (1 << 31 - Fe(42 | e) + 1) - 1, a &= i & ~(o & ~s), a = a & 201326741 ? a & 201326741 | 1 : a ? a | 2 : 0;
						}
						a !== 0 && (n = !0, Xu(r, a));
					} else a = Y, a = He(r, r === q ? a : 0, r.cancelPendingCommit !== null || r.timeoutHandle !== -1), !(a & 3) || Ue(r, a) || (n = !0, Xu(r, a));
					r = r.next;
				}
			while (n);
			Hu = !1;
		}
	}
	function Ku() {
		qu();
	}
	function qu() {
		Vu = Bu = !1;
		var e = 0;
		Uu !== 0 && (jd() && (e = Uu), Uu = 0);
		for (var t = Ce(), n = null, r = Ru; r !== null;) {
			var i = r.next, a = Ju(r, t);
			a === 0 ? (r.next = null, n === null ? Ru = i : n.next = i, i === null && (zu = n)) : (n = r, (e !== 0 || a & 3) && (Vu = !0)), r = i;
		}
		Gu(e, !1);
	}
	function Ju(e, t) {
		for (var n = e.suspendedLanes, r = e.pingedLanes, i = e.expirationTimes, a = e.pendingLanes & -62914561; 0 < a;) {
			var o = 31 - Fe(a), s = 1 << o, c = i[o];
			c === -1 ? ((s & n) === 0 || (s & r) !== 0) && (i[o] = We(s, t)) : c <= t && (e.expiredLanes |= s), a &= ~s;
		}
		if (t = q, n = Y, n = He(e, e === t ? n : 0, e.cancelPendingCommit !== null || e.timeoutHandle !== -1), r = e.callbackNode, n === 0 || e === t && (X === 2 || X === 9) || e.cancelPendingCommit !== null) return r !== null && r !== null && be(r), e.callbackNode = null, e.callbackPriority = 0;
		if (!(n & 3) || Ue(e, n)) {
			if (t = n & -n, t === e.callbackPriority) return t;
			switch (r !== null && be(r), $e(n)) {
				case 2:
				case 8:
					n = Ee;
					break;
				case 32:
					n = De;
					break;
				case 268435456:
					n = ke;
					break;
				default: n = De;
			}
			return r = Yu.bind(null, e), n = ye(n, r), e.callbackPriority = t, e.callbackNode = n, t;
		}
		return r !== null && r !== null && be(r), e.callbackPriority = 2, e.callbackNode = null, 2;
	}
	function Yu(e, t) {
		if (Kl !== 0 && Kl !== 5) return e.callbackNode = null, e.callbackPriority = 0, null;
		var n = e.callbackNode;
		if (ku(!0) && e.callbackNode !== n) return null;
		var r = Y;
		return r = He(e, e === q ? r : 0, e.cancelPendingCommit !== null || e.timeoutHandle !== -1), r === 0 ? null : (iu(e, r, t), Ju(e, Ce()), e.callbackNode != null && e.callbackNode === n ? Yu.bind(null, e) : null);
	}
	function Xu(e, t) {
		if (ku()) return null;
		iu(e, t, !0);
	}
	function Zu() {
		Fd(function() {
			K & 6 ? ye(Te, Ku) : qu();
		});
	}
	function Qu() {
		return Uu === 0 && (Uu = Ge()), Uu;
	}
	function $u(e) {
		return e == null || typeof e == "symbol" || typeof e == "boolean" ? null : typeof e == "function" ? e : Qt("" + e);
	}
	function ed(e, t) {
		var n = t.ownerDocument.createElement("input");
		return n.name = t.name, n.value = t.value, e.id && n.setAttribute("form", e.id), t.parentNode.insertBefore(n, t), e = new FormData(e), n.parentNode.removeChild(n), e;
	}
	function td(e, t, n, r, i) {
		if (t === "submit" && n && n.stateNode === i) {
			var a = $u((i[it] || null).action), o = r.submitter;
			o && (t = (t = o[it] || null) ? $u(t.formAction) : o.getAttribute("formAction"), t !== null && (a = t, o = null));
			var s = new bn("action", "action", null, r, i);
			e.push({
				event: s,
				listeners: [{
					instance: null,
					listener: function() {
						if (r.defaultPrevented) {
							if (Uu !== 0) {
								var e = o ? ed(i, o) : new FormData(i);
								ts(n, {
									pending: !0,
									data: e,
									method: i.method,
									action: a
								}, null, e);
							}
						} else typeof a == "function" && (s.preventDefault(), e = o ? ed(i, o) : new FormData(i), ts(n, {
							pending: !0,
							data: e,
							method: i.method,
							action: a
						}, a, e));
					},
					currentTarget: i
				}]
			});
		}
	}
	for (var nd = 0; nd < qr.length; nd++) {
		var rd = qr[nd];
		Jr(rd.toLowerCase(), "on" + (rd[0].toUpperCase() + rd.slice(1)));
	}
	Jr(zr, "onAnimationEnd"), Jr(Br, "onAnimationIteration"), Jr(Vr, "onAnimationStart"), Jr("dblclick", "onDoubleClick"), Jr("focusin", "onFocus"), Jr("focusout", "onBlur"), Jr(Hr, "onTransitionRun"), Jr(Ur, "onTransitionStart"), Jr(Wr, "onTransitionCancel"), Jr(Gr, "onTransitionEnd"), bt("onMouseEnter", ["mouseout", "mouseover"]), bt("onMouseLeave", ["mouseout", "mouseover"]), bt("onPointerEnter", ["pointerout", "pointerover"]), bt("onPointerLeave", ["pointerout", "pointerover"]), yt("onChange", "change click focusin focusout input keydown keyup selectionchange".split(" ")), yt("onSelect", "focusout contextmenu dragend focusin keydown keyup mousedown mouseup selectionchange".split(" ")), yt("onBeforeInput", [
		"compositionend",
		"keypress",
		"textInput",
		"paste"
	]), yt("onCompositionEnd", "compositionend focusout keydown keypress keyup mousedown".split(" ")), yt("onCompositionStart", "compositionstart focusout keydown keypress keyup mousedown".split(" ")), yt("onCompositionUpdate", "compositionupdate focusout keydown keypress keyup mousedown".split(" "));
	var id = "abort canplay canplaythrough durationchange emptied encrypted ended error loadeddata loadedmetadata loadstart pause play playing progress ratechange resize seeked seeking stalled suspend timeupdate volumechange waiting".split(" "), ad = new Set("beforetoggle cancel close invalid load scroll scrollend toggle".split(" ").concat(id));
	function od(e, t) {
		t = (t & 4) != 0;
		for (var n = 0; n < e.length; n++) {
			var r = e[n], i = r.event;
			r = r.listeners;
			a: {
				var a = void 0;
				if (t) for (var o = r.length - 1; 0 <= o; o--) {
					var s = r[o], c = s.instance, l = s.currentTarget;
					if (s = s.listener, c !== a && i.isPropagationStopped()) break a;
					a = s, i.currentTarget = l;
					try {
						a(i);
					} catch (e) {
						Vs(e);
					}
					i.currentTarget = null, a = c;
				}
				else for (o = 0; o < r.length; o++) {
					if (s = r[o], c = s.instance, l = s.currentTarget, s = s.listener, c !== a && i.isPropagationStopped()) break a;
					a = s, i.currentTarget = l;
					try {
						a(i);
					} catch (e) {
						Vs(e);
					}
					i.currentTarget = null, a = c;
				}
			}
		}
	}
	function Q(e, t) {
		var n = t[ot];
		n === void 0 && (n = t[ot] = /* @__PURE__ */ new Set());
		var r = e + "__bubble";
		n.has(r) || (ud(t, e, 2, !1), n.add(r));
	}
	function sd(e, t, n) {
		var r = 0;
		t && (r |= 4), ud(n, e, r, t);
	}
	var cd = "_reactListening" + Math.random().toString(36).slice(2);
	function ld(e) {
		if (!e[cd]) {
			e[cd] = !0, _t.forEach(function(t) {
				t !== "selectionchange" && (ad.has(t) || sd(t, !1, e), sd(t, !0, e));
			});
			var t = e.nodeType === 9 ? e : e.ownerDocument;
			t === null || t[cd] || (t[cd] = !0, sd("selectionchange", !1, t));
		}
	}
	function ud(e, t, n, r) {
		switch (Xf(t)) {
			case 2:
				var i = Wf;
				break;
			case 8:
				i = Gf;
				break;
			default: i = Kf;
		}
		n = i.bind(null, t, n, e), i = void 0, !ln || t !== "touchstart" && t !== "touchmove" && t !== "wheel" || (i = !0), r ? i === void 0 ? e.addEventListener(t, n, !0) : e.addEventListener(t, n, {
			capture: !0,
			passive: i
		}) : i === void 0 ? e.addEventListener(t, n, !1) : e.addEventListener(t, n, { passive: i });
	}
	function dd(e, t, n, r, i) {
		var a = r;
		if (!(t & 1) && !(t & 2) && r !== null) a: for (;;) {
			if (r === null) return;
			var s = r.tag;
			if (s === 3 || s === 4) {
				var c = r.stateNode.containerInfo;
				if (c === i) break;
				if (s === 4) for (s = r.return; s !== null;) {
					var l = s.tag;
					if ((l === 3 || l === 4) && s.stateNode.containerInfo === i) return;
					s = s.return;
				}
				for (; c !== null;) {
					if (s = ft(c), s === null) return;
					if (l = s.tag, l === 5 || l === 6 || l === 26 || l === 27) {
						r = a = s;
						continue a;
					}
					c = c.parentNode;
				}
			}
			r = r.return;
		}
		on(function() {
			var r = a, i = en(n), s = [];
			a: {
				var c = Kr.get(e);
				if (c !== void 0) {
					var l = bn, u = e;
					switch (e) {
						case "keypress": if (hn(n) === 0) break a;
						case "keydown":
						case "keyup":
							l = Rn;
							break;
						case "focusin":
							u = "focus", l = kn;
							break;
						case "focusout":
							u = "blur", l = kn;
							break;
						case "beforeblur":
						case "afterblur":
							l = kn;
							break;
						case "click": if (n.button === 2) break a;
						case "auxclick":
						case "dblclick":
						case "mousedown":
						case "mousemove":
						case "mouseup":
						case "mouseout":
						case "mouseover":
						case "contextmenu":
							l = Dn;
							break;
						case "drag":
						case "dragend":
						case "dragenter":
						case "dragexit":
						case "dragleave":
						case "dragover":
						case "dragstart":
						case "drop":
							l = On;
							break;
						case "touchcancel":
						case "touchend":
						case "touchmove":
						case "touchstart":
							l = Bn;
							break;
						case zr:
						case Br:
						case Vr:
							l = An;
							break;
						case Gr:
							l = Vn;
							break;
						case "scroll":
						case "scrollend":
							l = Sn;
							break;
						case "wheel":
							l = Hn;
							break;
						case "copy":
						case "cut":
						case "paste":
							l = jn;
							break;
						case "gotpointercapture":
						case "lostpointercapture":
						case "pointercancel":
						case "pointerdown":
						case "pointermove":
						case "pointerout":
						case "pointerover":
						case "pointerup":
							l = zn;
							break;
						case "toggle":
						case "beforetoggle": l = Un;
					}
					var d = (t & 4) != 0, f = !d && (e === "scroll" || e === "scrollend"), p = d ? c === null ? null : c + "Capture" : c;
					d = [];
					for (var m = r, h; m !== null;) {
						var g = m;
						if (h = g.stateNode, g = g.tag, g !== 5 && g !== 26 && g !== 27 || h === null || p === null || (g = sn(m, p), g != null && d.push(fd(m, g, h))), f) break;
						m = m.return;
					}
					0 < d.length && (c = new l(c, u, null, n, i), s.push({
						event: c,
						listeners: d
					}));
				}
			}
			if (!(t & 7)) {
				a: {
					if (c = e === "mouseover" || e === "pointerover", l = e === "mouseout" || e === "pointerout", c && n !== $t && (u = n.relatedTarget || n.fromElement) && (ft(u) || u[at])) break a;
					if ((l || c) && (c = i.window === i ? i : (c = i.ownerDocument) ? c.defaultView || c.parentWindow : window, l ? (u = n.relatedTarget || n.toElement, l = r, u = u ? ft(u) : null, u !== null && (f = o(u), d = u.tag, u !== f || d !== 5 && d !== 27 && d !== 6) && (u = null)) : (l = null, u = r), l !== u)) {
						if (d = Dn, g = "onMouseLeave", p = "onMouseEnter", m = "mouse", (e === "pointerout" || e === "pointerover") && (d = zn, g = "onPointerLeave", p = "onPointerEnter", m = "pointer"), f = l == null ? c : mt(l), h = u == null ? c : mt(u), c = new d(g, m + "leave", l, n, i), c.target = f, c.relatedTarget = h, g = null, ft(i) === r && (d = new d(p, m + "enter", u, n, i), d.target = h, d.relatedTarget = f, g = d), f = g, l && u) b: {
							for (d = l, p = u, m = 0, h = d; h; h = md(h)) m++;
							for (h = 0, g = p; g; g = md(g)) h++;
							for (; 0 < m - h;) d = md(d), m--;
							for (; 0 < h - m;) p = md(p), h--;
							for (; m--;) {
								if (d === p || p !== null && d === p.alternate) break b;
								d = md(d), p = md(p);
							}
							d = null;
						}
						else d = null;
						l !== null && hd(s, c, l, d, !1), u !== null && f !== null && hd(s, f, u, d, !0);
					}
				}
				a: {
					if (c = r ? mt(r) : window, l = c.nodeName && c.nodeName.toLowerCase(), l === "select" || l === "input" && c.type === "file") var _ = lr;
					else if (rr(c)) if (ur) _ = yr;
					else {
						_ = _r;
						var v = gr;
					}
					else l = c.nodeName, !l || l.toLowerCase() !== "input" || c.type !== "checkbox" && c.type !== "radio" ? r && Yt(r.elementType) && (_ = lr) : _ = vr;
					if (_ &&= _(e, r)) {
						ir(s, _, n, i);
						break a;
					}
					v && v(e, c, r), e === "focusout" && r && c.type === "number" && r.memoizedProps.value != null && Ht(c, "number", c.value);
				}
				switch (v = r ? mt(r) : window, e) {
					case "focusin":
						(rr(v) || v.contentEditable === "true") && (kr = v, Ar = r, jr = null);
						break;
					case "focusout":
						jr = Ar = kr = null;
						break;
					case "mousedown":
						Mr = !0;
						break;
					case "contextmenu":
					case "mouseup":
					case "dragend":
						Mr = !1, Nr(s, n, i);
						break;
					case "selectionchange": if (Or) break;
					case "keydown":
					case "keyup": Nr(s, n, i);
				}
				var y;
				if (Gn) b: {
					switch (e) {
						case "compositionstart":
							var b = "onCompositionStart";
							break b;
						case "compositionend":
							b = "onCompositionEnd";
							break b;
						case "compositionupdate":
							b = "onCompositionUpdate";
							break b;
					}
					b = void 0;
				}
				else $n ? Zn(e, n) && (b = "onCompositionEnd") : e === "keydown" && n.keyCode === 229 && (b = "onCompositionStart");
				b && (Jn && n.locale !== "ko" && ($n || b !== "onCompositionStart" ? b === "onCompositionEnd" && $n && (y = mn()) : (dn = i, fn = "value" in dn ? dn.value : dn.textContent, $n = !0)), v = pd(r, b), 0 < v.length && (b = new Mn(b, e, null, n, i), s.push({
					event: b,
					listeners: v
				}), y ? b.data = y : (y = Qn(n), y !== null && (b.data = y)))), (y = qn ? er(e, n) : tr(e, n)) && (b = pd(r, "onBeforeInput"), 0 < b.length && (v = new Mn("onBeforeInput", "beforeinput", null, n, i), s.push({
					event: v,
					listeners: b
				}), v.data = y)), td(s, e, r, n, i);
			}
			od(s, t);
		});
	}
	function fd(e, t, n) {
		return {
			instance: e,
			listener: t,
			currentTarget: n
		};
	}
	function pd(e, t) {
		for (var n = t + "Capture", r = []; e !== null;) {
			var i = e, a = i.stateNode;
			if (i = i.tag, i !== 5 && i !== 26 && i !== 27 || a === null || (i = sn(e, n), i != null && r.unshift(fd(e, i, a)), i = sn(e, t), i != null && r.push(fd(e, i, a))), e.tag === 3) return r;
			e = e.return;
		}
		return [];
	}
	function md(e) {
		if (e === null) return null;
		do
			e = e.return;
		while (e && e.tag !== 5 && e.tag !== 27);
		return e || null;
	}
	function hd(e, t, n, r, i) {
		for (var a = t._reactName, o = []; n !== null && n !== r;) {
			var s = n, c = s.alternate, l = s.stateNode;
			if (s = s.tag, c !== null && c === r) break;
			s !== 5 && s !== 26 && s !== 27 || l === null || (c = l, i ? (l = sn(n, a), l != null && o.unshift(fd(n, l, c))) : i || (l = sn(n, a), l != null && o.push(fd(n, l, c)))), n = n.return;
		}
		o.length !== 0 && e.push({
			event: t,
			listeners: o
		});
	}
	var gd = /\r\n?/g, _d = /\u0000|\uFFFD/g;
	function vd(e) {
		return (typeof e == "string" ? e : "" + e).replace(gd, "\n").replace(_d, "");
	}
	function yd(e, t) {
		return t = vd(t), vd(e) === t;
	}
	function bd() {}
	function $(e, t, n, r, a, o) {
		switch (n) {
			case "children":
				typeof r == "string" ? t === "body" || t === "textarea" && r === "" || Gt(e, r) : (typeof r == "number" || typeof r == "bigint") && t !== "body" && Gt(e, "" + r);
				break;
			case "className":
				Et(e, "class", r);
				break;
			case "tabIndex":
				Et(e, "tabindex", r);
				break;
			case "dir":
			case "role":
			case "viewBox":
			case "width":
			case "height":
				Et(e, n, r);
				break;
			case "style":
				Jt(e, r, o);
				break;
			case "data": if (t !== "object") {
				Et(e, "data", r);
				break;
			}
			case "src":
			case "href":
				if (r === "" && (t !== "a" || n !== "href")) {
					e.removeAttribute(n);
					break;
				}
				if (r == null || typeof r == "function" || typeof r == "symbol" || typeof r == "boolean") {
					e.removeAttribute(n);
					break;
				}
				r = Qt("" + r), e.setAttribute(n, r);
				break;
			case "action":
			case "formAction":
				if (typeof r == "function") {
					e.setAttribute(n, "javascript:throw new Error('A React form was unexpectedly submitted. If you called form.submit() manually, consider using form.requestSubmit() instead. If you\\'re trying to use event.stopPropagation() in a submit event handler, consider also calling event.preventDefault().')");
					break;
				} else typeof o == "function" && (n === "formAction" ? (t !== "input" && $(e, t, "name", a.name, a, null), $(e, t, "formEncType", a.formEncType, a, null), $(e, t, "formMethod", a.formMethod, a, null), $(e, t, "formTarget", a.formTarget, a, null)) : ($(e, t, "encType", a.encType, a, null), $(e, t, "method", a.method, a, null), $(e, t, "target", a.target, a, null)));
				if (r == null || typeof r == "symbol" || typeof r == "boolean") {
					e.removeAttribute(n);
					break;
				}
				r = Qt("" + r), e.setAttribute(n, r);
				break;
			case "onClick":
				r != null && (e.onclick = bd);
				break;
			case "onScroll":
				r != null && Q("scroll", e);
				break;
			case "onScrollEnd":
				r != null && Q("scrollend", e);
				break;
			case "dangerouslySetInnerHTML":
				if (r != null) {
					if (typeof r != "object" || !("__html" in r)) throw Error(i(61));
					if (n = r.__html, n != null) {
						if (a.children != null) throw Error(i(60));
						e.innerHTML = n;
					}
				}
				break;
			case "multiple":
				e.multiple = r && typeof r != "function" && typeof r != "symbol";
				break;
			case "muted":
				e.muted = r && typeof r != "function" && typeof r != "symbol";
				break;
			case "suppressContentEditableWarning":
			case "suppressHydrationWarning":
			case "defaultValue":
			case "defaultChecked":
			case "innerHTML":
			case "ref": break;
			case "autoFocus": break;
			case "xlinkHref":
				if (r == null || typeof r == "function" || typeof r == "boolean" || typeof r == "symbol") {
					e.removeAttribute("xlink:href");
					break;
				}
				n = Qt("" + r), e.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", n);
				break;
			case "contentEditable":
			case "spellCheck":
			case "draggable":
			case "value":
			case "autoReverse":
			case "externalResourcesRequired":
			case "focusable":
			case "preserveAlpha":
				r != null && typeof r != "function" && typeof r != "symbol" ? e.setAttribute(n, "" + r) : e.removeAttribute(n);
				break;
			case "inert":
			case "allowFullScreen":
			case "async":
			case "autoPlay":
			case "controls":
			case "default":
			case "defer":
			case "disabled":
			case "disablePictureInPicture":
			case "disableRemotePlayback":
			case "formNoValidate":
			case "hidden":
			case "loop":
			case "noModule":
			case "noValidate":
			case "open":
			case "playsInline":
			case "readOnly":
			case "required":
			case "reversed":
			case "scoped":
			case "seamless":
			case "itemScope":
				r && typeof r != "function" && typeof r != "symbol" ? e.setAttribute(n, "") : e.removeAttribute(n);
				break;
			case "capture":
			case "download":
				!0 === r ? e.setAttribute(n, "") : !1 !== r && r != null && typeof r != "function" && typeof r != "symbol" ? e.setAttribute(n, r) : e.removeAttribute(n);
				break;
			case "cols":
			case "rows":
			case "size":
			case "span":
				r != null && typeof r != "function" && typeof r != "symbol" && !isNaN(r) && 1 <= r ? e.setAttribute(n, r) : e.removeAttribute(n);
				break;
			case "rowSpan":
			case "start":
				r == null || typeof r == "function" || typeof r == "symbol" || isNaN(r) ? e.removeAttribute(n) : e.setAttribute(n, r);
				break;
			case "popover":
				Q("beforetoggle", e), Q("toggle", e), Tt(e, "popover", r);
				break;
			case "xlinkActuate":
				Dt(e, "http://www.w3.org/1999/xlink", "xlink:actuate", r);
				break;
			case "xlinkArcrole":
				Dt(e, "http://www.w3.org/1999/xlink", "xlink:arcrole", r);
				break;
			case "xlinkRole":
				Dt(e, "http://www.w3.org/1999/xlink", "xlink:role", r);
				break;
			case "xlinkShow":
				Dt(e, "http://www.w3.org/1999/xlink", "xlink:show", r);
				break;
			case "xlinkTitle":
				Dt(e, "http://www.w3.org/1999/xlink", "xlink:title", r);
				break;
			case "xlinkType":
				Dt(e, "http://www.w3.org/1999/xlink", "xlink:type", r);
				break;
			case "xmlBase":
				Dt(e, "http://www.w3.org/XML/1998/namespace", "xml:base", r);
				break;
			case "xmlLang":
				Dt(e, "http://www.w3.org/XML/1998/namespace", "xml:lang", r);
				break;
			case "xmlSpace":
				Dt(e, "http://www.w3.org/XML/1998/namespace", "xml:space", r);
				break;
			case "is":
				Tt(e, "is", r);
				break;
			case "innerText":
			case "textContent": break;
			default: (!(2 < n.length) || n[0] !== "o" && n[0] !== "O" || n[1] !== "n" && n[1] !== "N") && (n = Xt.get(n) || n, Tt(e, n, r));
		}
	}
	function xd(e, t, n, r, a, o) {
		switch (n) {
			case "style":
				Jt(e, r, o);
				break;
			case "dangerouslySetInnerHTML":
				if (r != null) {
					if (typeof r != "object" || !("__html" in r)) throw Error(i(61));
					if (n = r.__html, n != null) {
						if (a.children != null) throw Error(i(60));
						e.innerHTML = n;
					}
				}
				break;
			case "children":
				typeof r == "string" ? Gt(e, r) : (typeof r == "number" || typeof r == "bigint") && Gt(e, "" + r);
				break;
			case "onScroll":
				r != null && Q("scroll", e);
				break;
			case "onScrollEnd":
				r != null && Q("scrollend", e);
				break;
			case "onClick":
				r != null && (e.onclick = bd);
				break;
			case "suppressContentEditableWarning":
			case "suppressHydrationWarning":
			case "innerHTML":
			case "ref": break;
			case "innerText":
			case "textContent": break;
			default: if (!vt.hasOwnProperty(n)) a: {
				if (n[0] === "o" && n[1] === "n" && (a = n.endsWith("Capture"), t = n.slice(2, a ? n.length - 7 : void 0), o = e[it] || null, o = o == null ? null : o[n], typeof o == "function" && e.removeEventListener(t, o, a), typeof r == "function")) {
					typeof o != "function" && o !== null && (n in e ? e[n] = null : e.hasAttribute(n) && e.removeAttribute(n)), e.addEventListener(t, r, a);
					break a;
				}
				n in e ? e[n] = r : !0 === r ? e.setAttribute(n, "") : Tt(e, n, r);
			}
		}
	}
	function Sd(e, t, n) {
		switch (t) {
			case "div":
			case "span":
			case "svg":
			case "path":
			case "a":
			case "g":
			case "p":
			case "li": break;
			case "img":
				Q("error", e), Q("load", e);
				var r = !1, a = !1, o;
				for (o in n) if (n.hasOwnProperty(o)) {
					var s = n[o];
					if (s != null) switch (o) {
						case "src":
							r = !0;
							break;
						case "srcSet":
							a = !0;
							break;
						case "children":
						case "dangerouslySetInnerHTML": throw Error(i(137, t));
						default: $(e, t, o, s, n, null);
					}
				}
				a && $(e, t, "srcSet", n.srcSet, n, null), r && $(e, t, "src", n.src, n, null);
				return;
			case "input":
				Q("invalid", e);
				var c = o = s = a = null, l = null, u = null;
				for (r in n) if (n.hasOwnProperty(r)) {
					var d = n[r];
					if (d != null) switch (r) {
						case "name":
							a = d;
							break;
						case "type":
							s = d;
							break;
						case "checked":
							l = d;
							break;
						case "defaultChecked":
							u = d;
							break;
						case "value":
							o = d;
							break;
						case "defaultValue":
							c = d;
							break;
						case "children":
						case "dangerouslySetInnerHTML":
							if (d != null) throw Error(i(137, t));
							break;
						default: $(e, t, r, d, n, null);
					}
				}
				Vt(e, o, c, l, u, s, a, !1), Rt(e);
				return;
			case "select":
				for (a in Q("invalid", e), r = s = o = null, n) if (n.hasOwnProperty(a) && (c = n[a], c != null)) switch (a) {
					case "value":
						o = c;
						break;
					case "defaultValue":
						s = c;
						break;
					case "multiple": r = c;
					default: $(e, t, a, c, n, null);
				}
				t = o, n = s, e.multiple = !!r, t == null ? n != null && Ut(e, !!r, n, !0) : Ut(e, !!r, t, !1);
				return;
			case "textarea":
				for (s in Q("invalid", e), o = a = r = null, n) if (n.hasOwnProperty(s) && (c = n[s], c != null)) switch (s) {
					case "value":
						r = c;
						break;
					case "defaultValue":
						a = c;
						break;
					case "children":
						o = c;
						break;
					case "dangerouslySetInnerHTML":
						if (c != null) throw Error(i(91));
						break;
					default: $(e, t, s, c, n, null);
				}
				Wt(e, r, a, o), Rt(e);
				return;
			case "option":
				for (l in n) if (n.hasOwnProperty(l) && (r = n[l], r != null)) switch (l) {
					case "selected":
						e.selected = r && typeof r != "function" && typeof r != "symbol";
						break;
					default: $(e, t, l, r, n, null);
				}
				return;
			case "dialog":
				Q("beforetoggle", e), Q("toggle", e), Q("cancel", e), Q("close", e);
				break;
			case "iframe":
			case "object":
				Q("load", e);
				break;
			case "video":
			case "audio":
				for (r = 0; r < id.length; r++) Q(id[r], e);
				break;
			case "image":
				Q("error", e), Q("load", e);
				break;
			case "details":
				Q("toggle", e);
				break;
			case "embed":
			case "source":
			case "link": Q("error", e), Q("load", e);
			case "area":
			case "base":
			case "br":
			case "col":
			case "hr":
			case "keygen":
			case "meta":
			case "param":
			case "track":
			case "wbr":
			case "menuitem":
				for (u in n) if (n.hasOwnProperty(u) && (r = n[u], r != null)) switch (u) {
					case "children":
					case "dangerouslySetInnerHTML": throw Error(i(137, t));
					default: $(e, t, u, r, n, null);
				}
				return;
			default: if (Yt(t)) {
				for (d in n) n.hasOwnProperty(d) && (r = n[d], r !== void 0 && xd(e, t, d, r, n, void 0));
				return;
			}
		}
		for (c in n) n.hasOwnProperty(c) && (r = n[c], r != null && $(e, t, c, r, n, null));
	}
	function Cd(e, t, n, r) {
		switch (t) {
			case "div":
			case "span":
			case "svg":
			case "path":
			case "a":
			case "g":
			case "p":
			case "li": break;
			case "input":
				var a = null, o = null, s = null, c = null, l = null, u = null, d = null;
				for (m in n) {
					var f = n[m];
					if (n.hasOwnProperty(m) && f != null) switch (m) {
						case "checked": break;
						case "value": break;
						case "defaultValue": l = f;
						default: r.hasOwnProperty(m) || $(e, t, m, null, r, f);
					}
				}
				for (var p in r) {
					var m = r[p];
					if (f = n[p], r.hasOwnProperty(p) && (m != null || f != null)) switch (p) {
						case "type":
							o = m;
							break;
						case "name":
							a = m;
							break;
						case "checked":
							u = m;
							break;
						case "defaultChecked":
							d = m;
							break;
						case "value":
							s = m;
							break;
						case "defaultValue":
							c = m;
							break;
						case "children":
						case "dangerouslySetInnerHTML":
							if (m != null) throw Error(i(137, t));
							break;
						default: m !== f && $(e, t, p, m, r, f);
					}
				}
				Bt(e, s, c, l, u, d, o, a);
				return;
			case "select":
				for (o in m = s = c = p = null, n) if (l = n[o], n.hasOwnProperty(o) && l != null) switch (o) {
					case "value": break;
					case "multiple": m = l;
					default: r.hasOwnProperty(o) || $(e, t, o, null, r, l);
				}
				for (a in r) if (o = r[a], l = n[a], r.hasOwnProperty(a) && (o != null || l != null)) switch (a) {
					case "value":
						p = o;
						break;
					case "defaultValue":
						c = o;
						break;
					case "multiple": s = o;
					default: o !== l && $(e, t, a, o, r, l);
				}
				t = c, n = s, r = m, p == null ? !!r != !!n && (t == null ? Ut(e, !!n, n ? [] : "", !1) : Ut(e, !!n, t, !0)) : Ut(e, !!n, p, !1);
				return;
			case "textarea":
				for (c in m = p = null, n) if (a = n[c], n.hasOwnProperty(c) && a != null && !r.hasOwnProperty(c)) switch (c) {
					case "value": break;
					case "children": break;
					default: $(e, t, c, null, r, a);
				}
				for (s in r) if (a = r[s], o = n[s], r.hasOwnProperty(s) && (a != null || o != null)) switch (s) {
					case "value":
						p = a;
						break;
					case "defaultValue":
						m = a;
						break;
					case "children": break;
					case "dangerouslySetInnerHTML":
						if (a != null) throw Error(i(91));
						break;
					default: a !== o && $(e, t, s, a, r, o);
				}
				L(e, p, m);
				return;
			case "option":
				for (var h in n) if (p = n[h], n.hasOwnProperty(h) && p != null && !r.hasOwnProperty(h)) switch (h) {
					case "selected":
						e.selected = !1;
						break;
					default: $(e, t, h, null, r, p);
				}
				for (l in r) if (p = r[l], m = n[l], r.hasOwnProperty(l) && p !== m && (p != null || m != null)) switch (l) {
					case "selected":
						e.selected = p && typeof p != "function" && typeof p != "symbol";
						break;
					default: $(e, t, l, p, r, m);
				}
				return;
			case "img":
			case "link":
			case "area":
			case "base":
			case "br":
			case "col":
			case "embed":
			case "hr":
			case "keygen":
			case "meta":
			case "param":
			case "source":
			case "track":
			case "wbr":
			case "menuitem":
				for (var g in n) p = n[g], n.hasOwnProperty(g) && p != null && !r.hasOwnProperty(g) && $(e, t, g, null, r, p);
				for (u in r) if (p = r[u], m = n[u], r.hasOwnProperty(u) && p !== m && (p != null || m != null)) switch (u) {
					case "children":
					case "dangerouslySetInnerHTML":
						if (p != null) throw Error(i(137, t));
						break;
					default: $(e, t, u, p, r, m);
				}
				return;
			default: if (Yt(t)) {
				for (var _ in n) p = n[_], n.hasOwnProperty(_) && p !== void 0 && !r.hasOwnProperty(_) && xd(e, t, _, void 0, r, p);
				for (d in r) p = r[d], m = n[d], !r.hasOwnProperty(d) || p === m || p === void 0 && m === void 0 || xd(e, t, d, p, r, m);
				return;
			}
		}
		for (var v in n) p = n[v], n.hasOwnProperty(v) && p != null && !r.hasOwnProperty(v) && $(e, t, v, null, r, p);
		for (f in r) p = r[f], m = n[f], !r.hasOwnProperty(f) || p === m || p == null && m == null || $(e, t, f, p, r, m);
	}
	var wd = null, Td = null;
	function Ed(e) {
		return e.nodeType === 9 ? e : e.ownerDocument;
	}
	function Dd(e) {
		switch (e) {
			case "http://www.w3.org/2000/svg": return 1;
			case "http://www.w3.org/1998/Math/MathML": return 2;
			default: return 0;
		}
	}
	function Od(e, t) {
		if (e === 0) switch (t) {
			case "svg": return 1;
			case "math": return 2;
			default: return 0;
		}
		return e === 1 && t === "foreignObject" ? 0 : e;
	}
	function kd(e, t) {
		return e === "textarea" || e === "noscript" || typeof t.children == "string" || typeof t.children == "number" || typeof t.children == "bigint" || typeof t.dangerouslySetInnerHTML == "object" && t.dangerouslySetInnerHTML !== null && t.dangerouslySetInnerHTML.__html != null;
	}
	var Ad = null;
	function jd() {
		var e = window.event;
		return e && e.type === "popstate" ? e === Ad ? !1 : (Ad = e, !0) : (Ad = null, !1);
	}
	var Md = typeof setTimeout == "function" ? setTimeout : void 0, Nd = typeof clearTimeout == "function" ? clearTimeout : void 0, Pd = typeof Promise == "function" ? Promise : void 0, Fd = typeof queueMicrotask == "function" ? queueMicrotask : Pd === void 0 ? Md : function(e) {
		return Pd.resolve(null).then(e).catch(Id);
	};
	function Id(e) {
		setTimeout(function() {
			throw e;
		});
	}
	function Ld(e) {
		return e === "head";
	}
	function Rd(e, t) {
		var n = t, r = 0, i = 0;
		do {
			var a = n.nextSibling;
			if (e.removeChild(n), a && a.nodeType === 8) if (n = a.data, n === "/$") {
				if (0 < r && 8 > r) {
					n = r;
					var o = e.ownerDocument;
					if (n & 1 && Jd(o.documentElement), n & 2 && Jd(o.body), n & 4) for (n = o.head, Jd(n), o = n.firstChild; o;) {
						var s = o.nextSibling, c = o.nodeName;
						o[ut] || c === "SCRIPT" || c === "STYLE" || c === "LINK" && o.rel.toLowerCase() === "stylesheet" || n.removeChild(o), o = s;
					}
				}
				if (i === 0) {
					e.removeChild(a), hp(t);
					return;
				}
				i--;
			} else n === "$" || n === "$?" || n === "$!" ? i++ : r = n.charCodeAt(0) - 48;
			else r = 0;
			n = a;
		} while (n);
		hp(t);
	}
	function zd(e) {
		var t = e.firstChild;
		for (t && t.nodeType === 10 && (t = t.nextSibling); t;) {
			var n = t;
			switch (t = t.nextSibling, n.nodeName) {
				case "HTML":
				case "HEAD":
				case "BODY":
					zd(n), dt(n);
					continue;
				case "SCRIPT":
				case "STYLE": continue;
				case "LINK": if (n.rel.toLowerCase() === "stylesheet") continue;
			}
			e.removeChild(n);
		}
	}
	function Bd(e, t, n, r) {
		for (; e.nodeType === 1;) {
			var i = n;
			if (e.nodeName.toLowerCase() !== t.toLowerCase()) {
				if (!r && (e.nodeName !== "INPUT" || e.type !== "hidden")) break;
			} else if (!r) if (t === "input" && e.type === "hidden") {
				var a = i.name == null ? null : "" + i.name;
				if (i.type === "hidden" && e.getAttribute("name") === a) return e;
			} else return e;
			else if (!e[ut]) switch (t) {
				case "meta":
					if (!e.hasAttribute("itemprop")) break;
					return e;
				case "link":
					if (a = e.getAttribute("rel"), a === "stylesheet" && e.hasAttribute("data-precedence") || a !== i.rel || e.getAttribute("href") !== (i.href == null || i.href === "" ? null : i.href) || e.getAttribute("crossorigin") !== (i.crossOrigin == null ? null : i.crossOrigin) || e.getAttribute("title") !== (i.title == null ? null : i.title)) break;
					return e;
				case "style":
					if (e.hasAttribute("data-precedence")) break;
					return e;
				case "script":
					if (a = e.getAttribute("src"), (a !== (i.src == null ? null : i.src) || e.getAttribute("type") !== (i.type == null ? null : i.type) || e.getAttribute("crossorigin") !== (i.crossOrigin == null ? null : i.crossOrigin)) && a && e.hasAttribute("async") && !e.hasAttribute("itemprop")) break;
					return e;
				default: return e;
			}
			if (e = Wd(e.nextSibling), e === null) break;
		}
		return null;
	}
	function Vd(e, t, n) {
		if (t === "") return null;
		for (; e.nodeType !== 3;) if ((e.nodeType !== 1 || e.nodeName !== "INPUT" || e.type !== "hidden") && !n || (e = Wd(e.nextSibling), e === null)) return null;
		return e;
	}
	function Hd(e) {
		return e.data === "$!" || e.data === "$?" && e.ownerDocument.readyState === "complete";
	}
	function Ud(e, t) {
		var n = e.ownerDocument;
		if (e.data !== "$?" || n.readyState === "complete") t();
		else {
			var r = function() {
				t(), n.removeEventListener("DOMContentLoaded", r);
			};
			n.addEventListener("DOMContentLoaded", r), e._reactRetry = r;
		}
	}
	function Wd(e) {
		for (; e != null; e = e.nextSibling) {
			var t = e.nodeType;
			if (t === 1 || t === 3) break;
			if (t === 8) {
				if (t = e.data, t === "$" || t === "$!" || t === "$?" || t === "F!" || t === "F") break;
				if (t === "/$") return null;
			}
		}
		return e;
	}
	var Gd = null;
	function Kd(e) {
		e = e.previousSibling;
		for (var t = 0; e;) {
			if (e.nodeType === 8) {
				var n = e.data;
				if (n === "$" || n === "$!" || n === "$?") {
					if (t === 0) return e;
					t--;
				} else n === "/$" && t++;
			}
			e = e.previousSibling;
		}
		return null;
	}
	function qd(e, t, n) {
		switch (t = Ed(n), e) {
			case "html":
				if (e = t.documentElement, !e) throw Error(i(452));
				return e;
			case "head":
				if (e = t.head, !e) throw Error(i(453));
				return e;
			case "body":
				if (e = t.body, !e) throw Error(i(454));
				return e;
			default: throw Error(i(451));
		}
	}
	function Jd(e) {
		for (var t = e.attributes; t.length;) e.removeAttributeNode(t[0]);
		dt(e);
	}
	var Yd = /* @__PURE__ */ new Map(), Xd = /* @__PURE__ */ new Set();
	function Zd(e) {
		return typeof e.getRootNode == "function" ? e.getRootNode() : e.nodeType === 9 ? e : e.ownerDocument;
	}
	var Qd = j.d;
	j.d = {
		f: $d,
		r: ef,
		D: rf,
		C: af,
		L: of,
		m: sf,
		X: lf,
		S: cf,
		M: uf
	};
	function $d() {
		var e = Qd.f(), t = cu();
		return e || t;
	}
	function ef(e) {
		var t = pt(e);
		t !== null && t.tag === 5 && t.type === "form" ? rs(t) : Qd.r(e);
	}
	var tf = typeof document > "u" ? null : document;
	function nf(e, t, n) {
		var r = tf;
		if (r && typeof t == "string" && t) {
			var i = I(t);
			i = "link[rel=\"" + e + "\"][href=\"" + i + "\"]", typeof n == "string" && (i += "[crossorigin=\"" + n + "\"]"), Xd.has(i) || (Xd.add(i), e = {
				rel: e,
				crossOrigin: n,
				href: t
			}, r.querySelector(i) === null && (t = r.createElement("link"), Sd(t, "link", e), gt(t), r.head.appendChild(t)));
		}
	}
	function rf(e) {
		Qd.D(e), nf("dns-prefetch", e, null);
	}
	function af(e, t) {
		Qd.C(e, t), nf("preconnect", e, t);
	}
	function of(e, t, n) {
		Qd.L(e, t, n);
		var r = tf;
		if (r && e && t) {
			var i = "link[rel=\"preload\"][as=\"" + I(t) + "\"]";
			t === "image" && n && n.imageSrcSet ? (i += "[imagesrcset=\"" + I(n.imageSrcSet) + "\"]", typeof n.imageSizes == "string" && (i += "[imagesizes=\"" + I(n.imageSizes) + "\"]")) : i += "[href=\"" + I(e) + "\"]";
			var a = i;
			switch (t) {
				case "style":
					a = ff(e);
					break;
				case "script": a = gf(e);
			}
			Yd.has(a) || (e = f({
				rel: "preload",
				href: t === "image" && n && n.imageSrcSet ? void 0 : e,
				as: t
			}, n), Yd.set(a, e), r.querySelector(i) !== null || t === "style" && r.querySelector(pf(a)) || t === "script" && r.querySelector(_f(a)) || (t = r.createElement("link"), Sd(t, "link", e), gt(t), r.head.appendChild(t)));
		}
	}
	function sf(e, t) {
		Qd.m(e, t);
		var n = tf;
		if (n && e) {
			var r = t && typeof t.as == "string" ? t.as : "script", i = "link[rel=\"modulepreload\"][as=\"" + I(r) + "\"][href=\"" + I(e) + "\"]", a = i;
			switch (r) {
				case "audioworklet":
				case "paintworklet":
				case "serviceworker":
				case "sharedworker":
				case "worker":
				case "script": a = gf(e);
			}
			if (!Yd.has(a) && (e = f({
				rel: "modulepreload",
				href: e
			}, t), Yd.set(a, e), n.querySelector(i) === null)) {
				switch (r) {
					case "audioworklet":
					case "paintworklet":
					case "serviceworker":
					case "sharedworker":
					case "worker":
					case "script": if (n.querySelector(_f(a))) return;
				}
				r = n.createElement("link"), Sd(r, "link", e), gt(r), n.head.appendChild(r);
			}
		}
	}
	function cf(e, t, n) {
		Qd.S(e, t, n);
		var r = tf;
		if (r && e) {
			var i = ht(r).hoistableStyles, a = ff(e);
			t ||= "default";
			var o = i.get(a);
			if (!o) {
				var s = {
					loading: 0,
					preload: null
				};
				if (o = r.querySelector(pf(a))) s.loading = 5;
				else {
					e = f({
						rel: "stylesheet",
						href: e,
						"data-precedence": t
					}, n), (n = Yd.get(a)) && bf(e, n);
					var c = o = r.createElement("link");
					gt(c), Sd(c, "link", e), c._p = new Promise(function(e, t) {
						c.onload = e, c.onerror = t;
					}), c.addEventListener("load", function() {
						s.loading |= 1;
					}), c.addEventListener("error", function() {
						s.loading |= 2;
					}), s.loading |= 4, yf(o, t, r);
				}
				o = {
					type: "stylesheet",
					instance: o,
					count: 1,
					state: s
				}, i.set(a, o);
			}
		}
	}
	function lf(e, t) {
		Qd.X(e, t);
		var n = tf;
		if (n && e) {
			var r = ht(n).hoistableScripts, i = gf(e), a = r.get(i);
			a || (a = n.querySelector(_f(i)), a || (e = f({
				src: e,
				async: !0
			}, t), (t = Yd.get(i)) && xf(e, t), a = n.createElement("script"), gt(a), Sd(a, "link", e), n.head.appendChild(a)), a = {
				type: "script",
				instance: a,
				count: 1,
				state: null
			}, r.set(i, a));
		}
	}
	function uf(e, t) {
		Qd.M(e, t);
		var n = tf;
		if (n && e) {
			var r = ht(n).hoistableScripts, i = gf(e), a = r.get(i);
			a || (a = n.querySelector(_f(i)), a || (e = f({
				src: e,
				async: !0,
				type: "module"
			}, t), (t = Yd.get(i)) && xf(e, t), a = n.createElement("script"), gt(a), Sd(a, "link", e), n.head.appendChild(a)), a = {
				type: "script",
				instance: a,
				count: 1,
				state: null
			}, r.set(i, a));
		}
	}
	function df(e, t, n, r) {
		var a = (a = fe.current) ? Zd(a) : null;
		if (!a) throw Error(i(446));
		switch (e) {
			case "meta":
			case "title": return null;
			case "style": return typeof n.precedence == "string" && typeof n.href == "string" ? (t = ff(n.href), n = ht(a).hoistableStyles, r = n.get(t), r || (r = {
				type: "style",
				instance: null,
				count: 0,
				state: null
			}, n.set(t, r)), r) : {
				type: "void",
				instance: null,
				count: 0,
				state: null
			};
			case "link":
				if (n.rel === "stylesheet" && typeof n.href == "string" && typeof n.precedence == "string") {
					e = ff(n.href);
					var o = ht(a).hoistableStyles, s = o.get(e);
					if (s || (a = a.ownerDocument || a, s = {
						type: "stylesheet",
						instance: null,
						count: 0,
						state: {
							loading: 0,
							preload: null
						}
					}, o.set(e, s), (o = a.querySelector(pf(e))) && !o._p && (s.instance = o, s.state.loading = 5), Yd.has(e) || (n = {
						rel: "preload",
						as: "style",
						href: n.href,
						crossOrigin: n.crossOrigin,
						integrity: n.integrity,
						media: n.media,
						hrefLang: n.hrefLang,
						referrerPolicy: n.referrerPolicy
					}, Yd.set(e, n), o || hf(a, e, n, s.state))), t && r === null) throw Error(i(528, ""));
					return s;
				}
				if (t && r !== null) throw Error(i(529, ""));
				return null;
			case "script": return t = n.async, n = n.src, typeof n == "string" && t && typeof t != "function" && typeof t != "symbol" ? (t = gf(n), n = ht(a).hoistableScripts, r = n.get(t), r || (r = {
				type: "script",
				instance: null,
				count: 0,
				state: null
			}, n.set(t, r)), r) : {
				type: "void",
				instance: null,
				count: 0,
				state: null
			};
			default: throw Error(i(444, e));
		}
	}
	function ff(e) {
		return "href=\"" + I(e) + "\"";
	}
	function pf(e) {
		return "link[rel=\"stylesheet\"][" + e + "]";
	}
	function mf(e) {
		return f({}, e, {
			"data-precedence": e.precedence,
			precedence: null
		});
	}
	function hf(e, t, n, r) {
		e.querySelector("link[rel=\"preload\"][as=\"style\"][" + t + "]") ? r.loading = 1 : (t = e.createElement("link"), r.preload = t, t.addEventListener("load", function() {
			return r.loading |= 1;
		}), t.addEventListener("error", function() {
			return r.loading |= 2;
		}), Sd(t, "link", n), gt(t), e.head.appendChild(t));
	}
	function gf(e) {
		return "[src=\"" + I(e) + "\"]";
	}
	function _f(e) {
		return "script[async]" + e;
	}
	function vf(e, t, n) {
		if (t.count++, t.instance === null) switch (t.type) {
			case "style":
				var r = e.querySelector("style[data-href~=\"" + I(n.href) + "\"]");
				if (r) return t.instance = r, gt(r), r;
				var a = f({}, n, {
					"data-href": n.href,
					"data-precedence": n.precedence,
					href: null,
					precedence: null
				});
				return r = (e.ownerDocument || e).createElement("style"), gt(r), Sd(r, "style", a), yf(r, n.precedence, e), t.instance = r;
			case "stylesheet":
				a = ff(n.href);
				var o = e.querySelector(pf(a));
				if (o) return t.state.loading |= 4, t.instance = o, gt(o), o;
				r = mf(n), (a = Yd.get(a)) && bf(r, a), o = (e.ownerDocument || e).createElement("link"), gt(o);
				var s = o;
				return s._p = new Promise(function(e, t) {
					s.onload = e, s.onerror = t;
				}), Sd(o, "link", r), t.state.loading |= 4, yf(o, n.precedence, e), t.instance = o;
			case "script": return o = gf(n.src), (a = e.querySelector(_f(o))) ? (t.instance = a, gt(a), a) : (r = n, (a = Yd.get(o)) && (r = f({}, n), xf(r, a)), e = e.ownerDocument || e, a = e.createElement("script"), gt(a), Sd(a, "link", r), e.head.appendChild(a), t.instance = a);
			case "void": return null;
			default: throw Error(i(443, t.type));
		}
		else t.type === "stylesheet" && !(t.state.loading & 4) && (r = t.instance, t.state.loading |= 4, yf(r, n.precedence, e));
		return t.instance;
	}
	function yf(e, t, n) {
		for (var r = n.querySelectorAll("link[rel=\"stylesheet\"][data-precedence],style[data-precedence]"), i = r.length ? r[r.length - 1] : null, a = i, o = 0; o < r.length; o++) {
			var s = r[o];
			if (s.dataset.precedence === t) a = s;
			else if (a !== i) break;
		}
		a ? a.parentNode.insertBefore(e, a.nextSibling) : (t = n.nodeType === 9 ? n.head : n, t.insertBefore(e, t.firstChild));
	}
	function bf(e, t) {
		e.crossOrigin ??= t.crossOrigin, e.referrerPolicy ??= t.referrerPolicy, e.title ??= t.title;
	}
	function xf(e, t) {
		e.crossOrigin ??= t.crossOrigin, e.referrerPolicy ??= t.referrerPolicy, e.integrity ??= t.integrity;
	}
	var Sf = null;
	function Cf(e, t, n) {
		if (Sf === null) {
			var r = /* @__PURE__ */ new Map(), i = Sf = /* @__PURE__ */ new Map();
			i.set(n, r);
		} else i = Sf, r = i.get(n), r || (r = /* @__PURE__ */ new Map(), i.set(n, r));
		if (r.has(e)) return r;
		for (r.set(e, null), n = n.getElementsByTagName(e), i = 0; i < n.length; i++) {
			var a = n[i];
			if (!(a[ut] || a[rt] || e === "link" && a.getAttribute("rel") === "stylesheet") && a.namespaceURI !== "http://www.w3.org/2000/svg") {
				var o = a.getAttribute(t) || "";
				o = e + o;
				var s = r.get(o);
				s ? s.push(a) : r.set(o, [a]);
			}
		}
		return r;
	}
	function wf(e, t, n) {
		e = e.ownerDocument || e, e.head.insertBefore(n, t === "title" ? e.querySelector("head > title") : null);
	}
	function Tf(e, t, n) {
		if (n === 1 || t.itemProp != null) return !1;
		switch (e) {
			case "meta":
			case "title": return !0;
			case "style":
				if (typeof t.precedence != "string" || typeof t.href != "string" || t.href === "") break;
				return !0;
			case "link":
				if (typeof t.rel != "string" || typeof t.href != "string" || t.href === "" || t.onLoad || t.onError) break;
				switch (t.rel) {
					case "stylesheet": return e = t.disabled, typeof t.precedence == "string" && e == null;
					default: return !0;
				}
			case "script": if (t.async && typeof t.async != "function" && typeof t.async != "symbol" && !t.onLoad && !t.onError && t.src && typeof t.src == "string") return !0;
		}
		return !1;
	}
	function Ef(e) {
		return !(e.type === "stylesheet" && !(e.state.loading & 3));
	}
	var Df = null;
	function Of() {}
	function kf(e, t, n) {
		if (Df === null) throw Error(i(475));
		var r = Df;
		if (t.type === "stylesheet" && (typeof n.media != "string" || !1 !== matchMedia(n.media).matches) && !(t.state.loading & 4)) {
			if (t.instance === null) {
				var a = ff(n.href), o = e.querySelector(pf(a));
				if (o) {
					e = o._p, typeof e == "object" && e && typeof e.then == "function" && (r.count++, r = jf.bind(r), e.then(r, r)), t.state.loading |= 4, t.instance = o, gt(o);
					return;
				}
				o = e.ownerDocument || e, n = mf(n), (a = Yd.get(a)) && bf(n, a), o = o.createElement("link"), gt(o);
				var s = o;
				s._p = new Promise(function(e, t) {
					s.onload = e, s.onerror = t;
				}), Sd(o, "link", n), t.instance = o;
			}
			r.stylesheets === null && (r.stylesheets = /* @__PURE__ */ new Map()), r.stylesheets.set(t, e), (e = t.state.preload) && !(t.state.loading & 3) && (r.count++, t = jf.bind(r), e.addEventListener("load", t), e.addEventListener("error", t));
		}
	}
	function Af() {
		if (Df === null) throw Error(i(475));
		var e = Df;
		return e.stylesheets && e.count === 0 && Nf(e, e.stylesheets), 0 < e.count ? function(t) {
			var n = setTimeout(function() {
				if (e.stylesheets && Nf(e, e.stylesheets), e.unsuspend) {
					var t = e.unsuspend;
					e.unsuspend = null, t();
				}
			}, 6e4);
			return e.unsuspend = t, function() {
				e.unsuspend = null, clearTimeout(n);
			};
		} : null;
	}
	function jf() {
		if (this.count--, this.count === 0) {
			if (this.stylesheets) Nf(this, this.stylesheets);
			else if (this.unsuspend) {
				var e = this.unsuspend;
				this.unsuspend = null, e();
			}
		}
	}
	var Mf = null;
	function Nf(e, t) {
		e.stylesheets = null, e.unsuspend !== null && (e.count++, Mf = /* @__PURE__ */ new Map(), t.forEach(Pf, e), Mf = null, jf.call(e));
	}
	function Pf(e, t) {
		if (!(t.state.loading & 4)) {
			var n = Mf.get(e);
			if (n) var r = n.get(null);
			else {
				n = /* @__PURE__ */ new Map(), Mf.set(e, n);
				for (var i = e.querySelectorAll("link[data-precedence],style[data-precedence]"), a = 0; a < i.length; a++) {
					var o = i[a];
					(o.nodeName === "LINK" || o.getAttribute("media") !== "not all") && (n.set(o.dataset.precedence, o), r = o);
				}
				r && n.set(null, r);
			}
			i = t.instance, o = i.getAttribute("data-precedence"), a = n.get(o) || r, a === r && n.set(null, i), n.set(o, i), this.count++, r = jf.bind(this), i.addEventListener("load", r), i.addEventListener("error", r), a ? a.parentNode.insertBefore(i, a.nextSibling) : (e = e.nodeType === 9 ? e.head : e, e.insertBefore(i, e.firstChild)), t.state.loading |= 4;
		}
	}
	var Ff = {
		$$typeof: S,
		Provider: null,
		Consumer: null,
		_currentValue: M,
		_currentValue2: M,
		_threadCount: 0
	};
	function If(e, t, n, r, i, a, o, s) {
		this.tag = 1, this.containerInfo = e, this.pingCache = this.current = this.pendingChildren = null, this.timeoutHandle = -1, this.callbackNode = this.next = this.pendingContext = this.context = this.cancelPendingCommit = null, this.callbackPriority = 0, this.expirationTimes = qe(-1), this.entangledLanes = this.shellSuspendCounter = this.errorRecoveryDisabledLanes = this.expiredLanes = this.warmLanes = this.pingedLanes = this.suspendedLanes = this.pendingLanes = 0, this.entanglements = qe(0), this.hiddenUpdates = qe(null), this.identifierPrefix = r, this.onUncaughtError = i, this.onCaughtError = a, this.onRecoverableError = o, this.pooledCache = null, this.pooledCacheLanes = 0, this.formState = s, this.incompleteTransitions = /* @__PURE__ */ new Map();
	}
	function Lf(e, t, n, r, i, a, o, s, c, l, u, d) {
		return e = new If(e, t, n, o, s, c, l, d), t = 1, !0 === a && (t |= 24), a = ci(3, null, null, t), e.current = a, a.stateNode = e, t = ra(), t.refCount++, e.pooledCache = t, t.refCount++, a.memoizedState = {
			element: r,
			isDehydrated: n,
			cache: t
		}, Oa(a), e;
	}
	function Rf(e) {
		return e ? (e = oi, e) : oi;
	}
	function zf(e, t, n, r, i, a) {
		i = Rf(i), r.context === null ? r.context = i : r.pendingContext = i, r = Aa(t), r.payload = { element: n }, a = a === void 0 ? null : a, a !== null && (r.callback = a), n = ja(e, r, t), n !== null && (ru(n, e, t), Ma(n, e, t));
	}
	function Bf(e, t) {
		if (e = e.memoizedState, e !== null && e.dehydrated !== null) {
			var n = e.retryLane;
			e.retryLane = n !== 0 && n < t ? n : t;
		}
	}
	function Vf(e, t) {
		Bf(e, t), (e = e.alternate) && Bf(e, t);
	}
	function Hf(e) {
		if (e.tag === 13) {
			var t = ri(e, 67108864);
			t !== null && ru(t, e, 67108864), Vf(e, 67108864);
		}
	}
	var Uf = !0;
	function Wf(e, t, n, r) {
		var i = A.T;
		A.T = null;
		var a = j.p;
		try {
			j.p = 2, Kf(e, t, n, r);
		} finally {
			j.p = a, A.T = i;
		}
	}
	function Gf(e, t, n, r) {
		var i = A.T;
		A.T = null;
		var a = j.p;
		try {
			j.p = 8, Kf(e, t, n, r);
		} finally {
			j.p = a, A.T = i;
		}
	}
	function Kf(e, t, n, r) {
		if (Uf) {
			var i = qf(r);
			if (i === null) dd(e, t, r, Jf, n), ap(e, r);
			else if (sp(i, e, t, n, r)) r.stopPropagation();
			else if (ap(e, r), t & 4 && -1 < ip.indexOf(e)) {
				for (; i !== null;) {
					var a = pt(i);
					if (a !== null) switch (a.tag) {
						case 3:
							if (a = a.stateNode, a.current.memoizedState.isDehydrated) {
								var o = Ve(a.pendingLanes);
								if (o !== 0) {
									var s = a;
									for (s.pendingLanes |= 2, s.entangledLanes |= 2; o;) {
										var c = 1 << 31 - Fe(o);
										s.entanglements[1] |= c, o &= ~c;
									}
									Wu(a), !(K & 6) && (Ul = Ce() + 500, Gu(0, !1));
								}
							}
							break;
						case 13: s = ri(a, 2), s !== null && ru(s, a, 2), cu(), Vf(a, 2);
					}
					if (a = qf(r), a === null && dd(e, t, r, Jf, n), a === i) break;
					i = a;
				}
				i !== null && r.stopPropagation();
			} else dd(e, t, r, null, n);
		}
	}
	function qf(e) {
		return e = en(e), Yf(e);
	}
	var Jf = null;
	function Yf(e) {
		if (Jf = null, e = ft(e), e !== null) {
			var t = o(e);
			if (t === null) e = null;
			else {
				var n = t.tag;
				if (n === 13) {
					if (e = s(t), e !== null) return e;
					e = null;
				} else if (n === 3) {
					if (t.stateNode.current.memoizedState.isDehydrated) return t.tag === 3 ? t.stateNode.containerInfo : null;
					e = null;
				} else t !== e && (e = null);
			}
		}
		return Jf = e, null;
	}
	function Xf(e) {
		switch (e) {
			case "beforetoggle":
			case "cancel":
			case "click":
			case "close":
			case "contextmenu":
			case "copy":
			case "cut":
			case "auxclick":
			case "dblclick":
			case "dragend":
			case "dragstart":
			case "drop":
			case "focusin":
			case "focusout":
			case "input":
			case "invalid":
			case "keydown":
			case "keypress":
			case "keyup":
			case "mousedown":
			case "mouseup":
			case "paste":
			case "pause":
			case "play":
			case "pointercancel":
			case "pointerdown":
			case "pointerup":
			case "ratechange":
			case "reset":
			case "resize":
			case "seeked":
			case "submit":
			case "toggle":
			case "touchcancel":
			case "touchend":
			case "touchstart":
			case "volumechange":
			case "change":
			case "selectionchange":
			case "textInput":
			case "compositionstart":
			case "compositionend":
			case "compositionupdate":
			case "beforeblur":
			case "afterblur":
			case "beforeinput":
			case "blur":
			case "fullscreenchange":
			case "focus":
			case "hashchange":
			case "popstate":
			case "select":
			case "selectstart": return 2;
			case "drag":
			case "dragenter":
			case "dragexit":
			case "dragleave":
			case "dragover":
			case "mousemove":
			case "mouseout":
			case "mouseover":
			case "pointermove":
			case "pointerout":
			case "pointerover":
			case "scroll":
			case "touchmove":
			case "wheel":
			case "mouseenter":
			case "mouseleave":
			case "pointerenter":
			case "pointerleave": return 8;
			case "message": switch (we()) {
				case Te: return 2;
				case Ee: return 8;
				case De:
				case Oe: return 32;
				case ke: return 268435456;
				default: return 32;
			}
			default: return 32;
		}
	}
	var Zf = !1, Qf = null, $f = null, ep = null, tp = /* @__PURE__ */ new Map(), np = /* @__PURE__ */ new Map(), rp = [], ip = "mousedown mouseup touchcancel touchend touchstart auxclick dblclick pointercancel pointerdown pointerup dragend dragstart drop compositionend compositionstart keydown keypress keyup input textInput copy cut paste click change contextmenu reset".split(" ");
	function ap(e, t) {
		switch (e) {
			case "focusin":
			case "focusout":
				Qf = null;
				break;
			case "dragenter":
			case "dragleave":
				$f = null;
				break;
			case "mouseover":
			case "mouseout":
				ep = null;
				break;
			case "pointerover":
			case "pointerout":
				tp.delete(t.pointerId);
				break;
			case "gotpointercapture":
			case "lostpointercapture": np.delete(t.pointerId);
		}
	}
	function op(e, t, n, r, i, a) {
		return e === null || e.nativeEvent !== a ? (e = {
			blockedOn: t,
			domEventName: n,
			eventSystemFlags: r,
			nativeEvent: a,
			targetContainers: [i]
		}, t !== null && (t = pt(t), t !== null && Hf(t)), e) : (e.eventSystemFlags |= r, t = e.targetContainers, i !== null && t.indexOf(i) === -1 && t.push(i), e);
	}
	function sp(e, t, n, r, i) {
		switch (t) {
			case "focusin": return Qf = op(Qf, e, t, n, r, i), !0;
			case "dragenter": return $f = op($f, e, t, n, r, i), !0;
			case "mouseover": return ep = op(ep, e, t, n, r, i), !0;
			case "pointerover":
				var a = i.pointerId;
				return tp.set(a, op(tp.get(a) || null, e, t, n, r, i)), !0;
			case "gotpointercapture": return a = i.pointerId, np.set(a, op(np.get(a) || null, e, t, n, r, i)), !0;
		}
		return !1;
	}
	function cp(e) {
		var t = ft(e.target);
		if (t !== null) {
			var n = o(t);
			if (n !== null) {
				if (t = n.tag, t === 13) {
					if (t = s(n), t !== null) {
						e.blockedOn = t, tt(e.priority, function() {
							if (n.tag === 13) {
								var e = tu();
								e = Qe(e);
								var t = ri(n, e);
								t !== null && ru(t, n, e), Vf(n, e);
							}
						});
						return;
					}
				} else if (t === 3 && n.stateNode.current.memoizedState.isDehydrated) {
					e.blockedOn = n.tag === 3 ? n.stateNode.containerInfo : null;
					return;
				}
			}
		}
		e.blockedOn = null;
	}
	function lp(e) {
		if (e.blockedOn !== null) return !1;
		for (var t = e.targetContainers; 0 < t.length;) {
			var n = qf(e.nativeEvent);
			if (n === null) {
				n = e.nativeEvent;
				var r = new n.constructor(n.type, n);
				$t = r, n.target.dispatchEvent(r), $t = null;
			} else return t = pt(n), t !== null && Hf(t), e.blockedOn = n, !1;
			t.shift();
		}
		return !0;
	}
	function up(e, t, n) {
		lp(e) && n.delete(t);
	}
	function dp() {
		Zf = !1, Qf !== null && lp(Qf) && (Qf = null), $f !== null && lp($f) && ($f = null), ep !== null && lp(ep) && (ep = null), tp.forEach(up), np.forEach(up);
	}
	function fp(e, n) {
		e.blockedOn === n && (e.blockedOn = null, Zf || (Zf = !0, t.unstable_scheduleCallback(t.unstable_NormalPriority, dp)));
	}
	var pp = null;
	function mp(e) {
		pp !== e && (pp = e, t.unstable_scheduleCallback(t.unstable_NormalPriority, function() {
			pp === e && (pp = null);
			for (var t = 0; t < e.length; t += 3) {
				var n = e[t], r = e[t + 1], i = e[t + 2];
				if (typeof r != "function") {
					if (Yf(r || n) === null) continue;
					break;
				}
				var a = pt(n);
				a !== null && (e.splice(t, 3), t -= 3, ts(a, {
					pending: !0,
					data: i,
					method: n.method,
					action: r
				}, r, i));
			}
		}));
	}
	function hp(e) {
		function t(t) {
			return fp(t, e);
		}
		Qf !== null && fp(Qf, e), $f !== null && fp($f, e), ep !== null && fp(ep, e), tp.forEach(t), np.forEach(t);
		for (var n = 0; n < rp.length; n++) {
			var r = rp[n];
			r.blockedOn === e && (r.blockedOn = null);
		}
		for (; 0 < rp.length && (n = rp[0], n.blockedOn === null);) cp(n), n.blockedOn === null && rp.shift();
		if (n = (e.ownerDocument || e).$$reactFormReplay, n != null) for (r = 0; r < n.length; r += 3) {
			var i = n[r], a = n[r + 1], o = i[it] || null;
			if (typeof a == "function") o || mp(n);
			else if (o) {
				var s = null;
				if (a && a.hasAttribute("formAction")) {
					if (i = a, o = a[it] || null) s = o.formAction;
					else if (Yf(i) !== null) continue;
				} else s = o.action;
				typeof s == "function" ? n[r + 1] = s : (n.splice(r, 3), r -= 3), mp(n);
			}
		}
	}
	function gp(e) {
		this._internalRoot = e;
	}
	_p.prototype.render = gp.prototype.render = function(e) {
		var t = this._internalRoot;
		if (t === null) throw Error(i(409));
		var n = t.current;
		zf(n, tu(), e, t, null, null);
	}, _p.prototype.unmount = gp.prototype.unmount = function() {
		var e = this._internalRoot;
		if (e !== null) {
			this._internalRoot = null;
			var t = e.containerInfo;
			zf(e.current, 2, null, e, null, null), cu(), t[at] = null;
		}
	};
	function _p(e) {
		this._internalRoot = e;
	}
	_p.prototype.unstable_scheduleHydration = function(e) {
		if (e) {
			var t = et();
			e = {
				blockedOn: null,
				target: e,
				priority: t
			};
			for (var n = 0; n < rp.length && t !== 0 && t < rp[n].priority; n++);
			rp.splice(n, 0, e), n === 0 && cp(e);
		}
	};
	var vp = n.version;
	if (vp !== "19.1.1") throw Error(i(527, vp, "19.1.1"));
	j.findDOMNode = function(e) {
		var t = e._reactInternals;
		if (t === void 0) throw typeof e.render == "function" ? Error(i(188)) : (e = Object.keys(e).join(","), Error(i(268, e)));
		return e = l(t), e = e === null ? null : u(e), e = e === null ? null : e.stateNode, e;
	};
	var yp = {
		bundleType: 0,
		version: "19.1.1",
		rendererPackageName: "react-dom",
		currentDispatcherRef: A,
		reconcilerVersion: "19.1.1"
	};
	if (typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ < "u") {
		var bp = __REACT_DEVTOOLS_GLOBAL_HOOK__;
		if (!bp.isDisabled && bp.supportsFiber) try {
			Me = bp.inject(yp), Ne = bp;
		} catch {}
	}
	e.createRoot = function(e, t) {
		if (!a(e)) throw Error(i(299));
		var n = !1, r = "", o = Hs, s = Us, c = Ws, l = null;
		return t != null && (!0 === t.unstable_strictMode && (n = !0), t.identifierPrefix !== void 0 && (r = t.identifierPrefix), t.onUncaughtError !== void 0 && (o = t.onUncaughtError), t.onCaughtError !== void 0 && (s = t.onCaughtError), t.onRecoverableError !== void 0 && (c = t.onRecoverableError), t.unstable_transitionCallbacks !== void 0 && (l = t.unstable_transitionCallbacks)), t = Lf(e, 1, !1, null, null, n, r, o, s, c, l, null), e[at] = t.current, ld(e), new gp(t);
	};
})), _ = /* @__PURE__ */ o(((e, t) => {
	function n() {
		if (!(typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ > "u" || typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE != "function")) try {
			__REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE(n);
		} catch (e) {
			console.error(e);
		}
	}
	n(), t.exports = g();
}));
//#endregion
//#region node_modules/comma-separated-tokens/index.js
function v(e, t) {
	let n = t || {};
	return (e[e.length - 1] === "" ? [...e, ""] : e).join((n.padRight ? " " : "") + "," + (n.padLeft === !1 ? "" : " ")).trim();
}
//#endregion
//#region node_modules/estree-util-is-identifier-name/lib/index.js
var y = /^[$_\p{ID_Start}][$_\u{200C}\u{200D}\p{ID_Continue}]*$/u, b = /^[$_\p{ID_Start}][-$_\u{200C}\u{200D}\p{ID_Continue}]*$/u, ee = {};
function x(e, t) {
	return ((t || ee).jsx ? b : y).test(e);
}
//#endregion
//#region node_modules/hast-util-whitespace/lib/index.js
var S = /[ \t\n\f\r]/g;
function te(e) {
	return typeof e == "object" ? e.type === "text" ? C(e.value) : !1 : C(e);
}
function C(e) {
	return e.replace(S, "") === "";
}
//#endregion
//#region node_modules/property-information/lib/util/schema.js
var w = class {
	constructor(e, t, n) {
		this.normal = t, this.property = e, n && (this.space = n);
	}
};
w.prototype.normal = {}, w.prototype.property = {}, w.prototype.space = void 0;
//#endregion
//#region node_modules/property-information/lib/util/merge.js
function ne(e, t) {
	let n = {}, r = {};
	for (let t of e) Object.assign(n, t.property), Object.assign(r, t.normal);
	return new w(n, r, t);
}
//#endregion
//#region node_modules/property-information/lib/normalize.js
function T(e) {
	return e.toLowerCase();
}
//#endregion
//#region node_modules/property-information/lib/util/info.js
var E = class {
	constructor(e, t) {
		this.attribute = t, this.property = e;
	}
};
E.prototype.attribute = "", E.prototype.booleanish = !1, E.prototype.boolean = !1, E.prototype.commaOrSpaceSeparated = !1, E.prototype.commaSeparated = !1, E.prototype.defined = !1, E.prototype.mustUseProperty = !1, E.prototype.number = !1, E.prototype.overloadedBoolean = !1, E.prototype.property = "", E.prototype.spaceSeparated = !1, E.prototype.space = void 0;
//#endregion
//#region node_modules/property-information/lib/util/types.js
var re = /* @__PURE__ */ s({
	boolean: () => D,
	booleanish: () => O,
	commaOrSpaceSeparated: () => M,
	commaSeparated: () => j,
	number: () => k,
	overloadedBoolean: () => ae,
	spaceSeparated: () => A
}), ie = 0, D = oe(), O = oe(), ae = oe(), k = oe(), A = oe(), j = oe(), M = oe();
function oe() {
	return 2 ** ++ie;
}
//#endregion
//#region node_modules/property-information/lib/util/defined-info.js
var se = Object.keys(re), ce = class extends E {
	constructor(e, t, n, r) {
		let i = -1;
		if (super(e, t), le(this, "space", r), typeof n == "number") for (; ++i < se.length;) {
			let e = se[i];
			le(this, se[i], (n & re[e]) === re[e]);
		}
	}
};
ce.prototype.defined = !0;
function le(e, t, n) {
	n && (e[t] = n);
}
//#endregion
//#region node_modules/property-information/lib/util/create.js
function N(e) {
	let t = {}, n = {};
	for (let [r, i] of Object.entries(e.properties)) {
		let a = new ce(r, e.transform(e.attributes || {}, r), i, e.space);
		e.mustUseProperty && e.mustUseProperty.includes(r) && (a.mustUseProperty = !0), t[r] = a, n[T(r)] = r, n[T(a.attribute)] = r;
	}
	return new w(t, n, e.space);
}
//#endregion
//#region node_modules/property-information/lib/aria.js
var ue = N({
	properties: {
		ariaActiveDescendant: null,
		ariaAtomic: O,
		ariaAutoComplete: null,
		ariaBusy: O,
		ariaChecked: O,
		ariaColCount: k,
		ariaColIndex: k,
		ariaColSpan: k,
		ariaControls: A,
		ariaCurrent: null,
		ariaDescribedBy: A,
		ariaDetails: null,
		ariaDisabled: O,
		ariaDropEffect: A,
		ariaErrorMessage: null,
		ariaExpanded: O,
		ariaFlowTo: A,
		ariaGrabbed: O,
		ariaHasPopup: null,
		ariaHidden: O,
		ariaInvalid: null,
		ariaKeyShortcuts: null,
		ariaLabel: null,
		ariaLabelledBy: A,
		ariaLevel: k,
		ariaLive: null,
		ariaModal: O,
		ariaMultiLine: O,
		ariaMultiSelectable: O,
		ariaOrientation: null,
		ariaOwns: A,
		ariaPlaceholder: null,
		ariaPosInSet: k,
		ariaPressed: O,
		ariaReadOnly: O,
		ariaRelevant: null,
		ariaRequired: O,
		ariaRoleDescription: A,
		ariaRowCount: k,
		ariaRowIndex: k,
		ariaRowSpan: k,
		ariaSelected: O,
		ariaSetSize: k,
		ariaSort: null,
		ariaValueMax: k,
		ariaValueMin: k,
		ariaValueNow: k,
		ariaValueText: null,
		role: null
	},
	transform(e, t) {
		return t === "role" ? t : "aria-" + t.slice(4).toLowerCase();
	}
});
//#endregion
//#region node_modules/property-information/lib/util/case-sensitive-transform.js
function de(e, t) {
	return t in e ? e[t] : t;
}
//#endregion
//#region node_modules/property-information/lib/util/case-insensitive-transform.js
function fe(e, t) {
	return de(e, t.toLowerCase());
}
//#endregion
//#region node_modules/property-information/lib/html.js
var pe = N({
	attributes: {
		acceptcharset: "accept-charset",
		classname: "class",
		htmlfor: "for",
		httpequiv: "http-equiv"
	},
	mustUseProperty: [
		"checked",
		"multiple",
		"muted",
		"selected"
	],
	properties: {
		abbr: null,
		accept: j,
		acceptCharset: A,
		accessKey: A,
		action: null,
		allow: null,
		allowFullScreen: D,
		allowPaymentRequest: D,
		allowUserMedia: D,
		alpha: D,
		alt: null,
		as: null,
		async: D,
		autoCapitalize: null,
		autoComplete: A,
		autoFocus: D,
		autoPlay: D,
		blocking: A,
		capture: null,
		charSet: null,
		checked: D,
		cite: null,
		className: A,
		closedBy: null,
		colorSpace: null,
		cols: k,
		colSpan: k,
		command: null,
		commandFor: null,
		content: null,
		contentEditable: O,
		controls: D,
		controlsList: A,
		coords: k | j,
		crossOrigin: null,
		data: null,
		dateTime: null,
		decoding: null,
		default: D,
		defer: D,
		dir: null,
		dirName: null,
		disabled: D,
		download: ae,
		draggable: O,
		encType: null,
		enterKeyHint: null,
		fetchPriority: null,
		form: null,
		formAction: null,
		formEncType: null,
		formMethod: null,
		formNoValidate: D,
		formTarget: null,
		headers: A,
		height: k,
		hidden: ae,
		high: k,
		href: null,
		hrefLang: null,
		htmlFor: A,
		httpEquiv: A,
		id: null,
		imageSizes: null,
		imageSrcSet: null,
		inert: D,
		inputMode: null,
		integrity: null,
		is: null,
		isMap: D,
		itemId: null,
		itemProp: A,
		itemRef: A,
		itemScope: D,
		itemType: A,
		kind: null,
		label: null,
		lang: null,
		language: null,
		list: null,
		loading: null,
		loop: D,
		low: k,
		manifest: null,
		max: null,
		maxLength: k,
		media: null,
		method: null,
		min: null,
		minLength: k,
		multiple: D,
		muted: D,
		name: null,
		nonce: null,
		noModule: D,
		noValidate: D,
		onAbort: null,
		onAfterPrint: null,
		onAuxClick: null,
		onBeforeMatch: null,
		onBeforePrint: null,
		onBeforeToggle: null,
		onBeforeUnload: null,
		onBlur: null,
		onCancel: null,
		onCanPlay: null,
		onCanPlayThrough: null,
		onChange: null,
		onClick: null,
		onClose: null,
		onContextLost: null,
		onContextMenu: null,
		onContextRestored: null,
		onCopy: null,
		onCueChange: null,
		onCut: null,
		onDblClick: null,
		onDrag: null,
		onDragEnd: null,
		onDragEnter: null,
		onDragExit: null,
		onDragLeave: null,
		onDragOver: null,
		onDragStart: null,
		onDrop: null,
		onDurationChange: null,
		onEmptied: null,
		onEnded: null,
		onError: null,
		onFocus: null,
		onFormData: null,
		onHashChange: null,
		onInput: null,
		onInvalid: null,
		onKeyDown: null,
		onKeyPress: null,
		onKeyUp: null,
		onLanguageChange: null,
		onLoad: null,
		onLoadedData: null,
		onLoadedMetadata: null,
		onLoadEnd: null,
		onLoadStart: null,
		onMessage: null,
		onMessageError: null,
		onMouseDown: null,
		onMouseEnter: null,
		onMouseLeave: null,
		onMouseMove: null,
		onMouseOut: null,
		onMouseOver: null,
		onMouseUp: null,
		onOffline: null,
		onOnline: null,
		onPageHide: null,
		onPageShow: null,
		onPaste: null,
		onPause: null,
		onPlay: null,
		onPlaying: null,
		onPopState: null,
		onProgress: null,
		onRateChange: null,
		onRejectionHandled: null,
		onReset: null,
		onResize: null,
		onScroll: null,
		onScrollEnd: null,
		onSecurityPolicyViolation: null,
		onSeeked: null,
		onSeeking: null,
		onSelect: null,
		onSlotChange: null,
		onStalled: null,
		onStorage: null,
		onSubmit: null,
		onSuspend: null,
		onTimeUpdate: null,
		onToggle: null,
		onUnhandledRejection: null,
		onUnload: null,
		onVolumeChange: null,
		onWaiting: null,
		onWheel: null,
		open: D,
		optimum: k,
		pattern: null,
		ping: A,
		placeholder: null,
		playsInline: D,
		popover: null,
		popoverTarget: null,
		popoverTargetAction: null,
		poster: null,
		preload: null,
		readOnly: D,
		referrerPolicy: null,
		rel: A,
		required: D,
		reversed: D,
		rows: k,
		rowSpan: k,
		sandbox: A,
		scope: null,
		scoped: D,
		seamless: D,
		selected: D,
		shadowRootClonable: D,
		shadowRootCustomElementRegistry: D,
		shadowRootDelegatesFocus: D,
		shadowRootMode: null,
		shadowRootSerializable: D,
		shape: null,
		size: k,
		sizes: null,
		slot: null,
		span: k,
		spellCheck: O,
		src: null,
		srcDoc: null,
		srcLang: null,
		srcSet: null,
		start: k,
		step: null,
		style: null,
		tabIndex: k,
		target: null,
		title: null,
		translate: null,
		type: null,
		typeMustMatch: D,
		useMap: null,
		value: O,
		width: k,
		wrap: null,
		writingSuggestions: null,
		align: null,
		aLink: null,
		archive: A,
		axis: null,
		background: null,
		bgColor: null,
		border: k,
		borderColor: null,
		bottomMargin: k,
		cellPadding: null,
		cellSpacing: null,
		char: null,
		charOff: null,
		classId: null,
		clear: null,
		code: null,
		codeBase: null,
		codeType: null,
		color: null,
		compact: D,
		declare: D,
		event: null,
		face: null,
		frame: null,
		frameBorder: null,
		hSpace: k,
		leftMargin: k,
		link: null,
		longDesc: null,
		lowSrc: null,
		marginHeight: k,
		marginWidth: k,
		noResize: D,
		noHref: D,
		noShade: D,
		noWrap: D,
		object: null,
		profile: null,
		prompt: null,
		rev: null,
		rightMargin: k,
		rules: null,
		scheme: null,
		scrolling: O,
		standby: null,
		summary: null,
		text: null,
		topMargin: k,
		valueType: null,
		version: null,
		vAlign: null,
		vLink: null,
		vSpace: k,
		allowTransparency: null,
		autoCorrect: null,
		autoSave: null,
		credentialless: D,
		disablePictureInPicture: D,
		disableRemotePlayback: D,
		exportParts: j,
		part: A,
		prefix: null,
		property: null,
		results: k,
		security: null,
		unselectable: null
	},
	space: "html",
	transform: fe
}), me = N({
	attributes: {
		accentHeight: "accent-height",
		alignmentBaseline: "alignment-baseline",
		arabicForm: "arabic-form",
		baselineShift: "baseline-shift",
		capHeight: "cap-height",
		className: "class",
		clipPath: "clip-path",
		clipRule: "clip-rule",
		colorInterpolation: "color-interpolation",
		colorInterpolationFilters: "color-interpolation-filters",
		colorProfile: "color-profile",
		colorRendering: "color-rendering",
		crossOrigin: "crossorigin",
		dataType: "datatype",
		dominantBaseline: "dominant-baseline",
		enableBackground: "enable-background",
		fillOpacity: "fill-opacity",
		fillRule: "fill-rule",
		floodColor: "flood-color",
		floodOpacity: "flood-opacity",
		fontFamily: "font-family",
		fontSize: "font-size",
		fontSizeAdjust: "font-size-adjust",
		fontStretch: "font-stretch",
		fontStyle: "font-style",
		fontVariant: "font-variant",
		fontWeight: "font-weight",
		glyphName: "glyph-name",
		glyphOrientationHorizontal: "glyph-orientation-horizontal",
		glyphOrientationVertical: "glyph-orientation-vertical",
		hrefLang: "hreflang",
		horizAdvX: "horiz-adv-x",
		horizOriginX: "horiz-origin-x",
		horizOriginY: "horiz-origin-y",
		imageRendering: "image-rendering",
		letterSpacing: "letter-spacing",
		lightingColor: "lighting-color",
		markerEnd: "marker-end",
		markerMid: "marker-mid",
		markerStart: "marker-start",
		maskType: "mask-type",
		navDown: "nav-down",
		navDownLeft: "nav-down-left",
		navDownRight: "nav-down-right",
		navLeft: "nav-left",
		navNext: "nav-next",
		navPrev: "nav-prev",
		navRight: "nav-right",
		navUp: "nav-up",
		navUpLeft: "nav-up-left",
		navUpRight: "nav-up-right",
		onAbort: "onabort",
		onActivate: "onactivate",
		onAfterPrint: "onafterprint",
		onBeforePrint: "onbeforeprint",
		onBegin: "onbegin",
		onCancel: "oncancel",
		onCanPlay: "oncanplay",
		onCanPlayThrough: "oncanplaythrough",
		onChange: "onchange",
		onClick: "onclick",
		onClose: "onclose",
		onCopy: "oncopy",
		onCueChange: "oncuechange",
		onCut: "oncut",
		onDblClick: "ondblclick",
		onDrag: "ondrag",
		onDragEnd: "ondragend",
		onDragEnter: "ondragenter",
		onDragExit: "ondragexit",
		onDragLeave: "ondragleave",
		onDragOver: "ondragover",
		onDragStart: "ondragstart",
		onDrop: "ondrop",
		onDurationChange: "ondurationchange",
		onEmptied: "onemptied",
		onEnd: "onend",
		onEnded: "onended",
		onError: "onerror",
		onFocus: "onfocus",
		onFocusIn: "onfocusin",
		onFocusOut: "onfocusout",
		onHashChange: "onhashchange",
		onInput: "oninput",
		onInvalid: "oninvalid",
		onKeyDown: "onkeydown",
		onKeyPress: "onkeypress",
		onKeyUp: "onkeyup",
		onLoad: "onload",
		onLoadedData: "onloadeddata",
		onLoadedMetadata: "onloadedmetadata",
		onLoadStart: "onloadstart",
		onMessage: "onmessage",
		onMouseDown: "onmousedown",
		onMouseEnter: "onmouseenter",
		onMouseLeave: "onmouseleave",
		onMouseMove: "onmousemove",
		onMouseOut: "onmouseout",
		onMouseOver: "onmouseover",
		onMouseUp: "onmouseup",
		onMouseWheel: "onmousewheel",
		onOffline: "onoffline",
		onOnline: "ononline",
		onPageHide: "onpagehide",
		onPageShow: "onpageshow",
		onPaste: "onpaste",
		onPause: "onpause",
		onPlay: "onplay",
		onPlaying: "onplaying",
		onPopState: "onpopstate",
		onProgress: "onprogress",
		onRateChange: "onratechange",
		onRepeat: "onrepeat",
		onReset: "onreset",
		onResize: "onresize",
		onScroll: "onscroll",
		onSeeked: "onseeked",
		onSeeking: "onseeking",
		onSelect: "onselect",
		onShow: "onshow",
		onStalled: "onstalled",
		onStorage: "onstorage",
		onSubmit: "onsubmit",
		onSuspend: "onsuspend",
		onTimeUpdate: "ontimeupdate",
		onToggle: "ontoggle",
		onUnload: "onunload",
		onVolumeChange: "onvolumechange",
		onWaiting: "onwaiting",
		onZoom: "onzoom",
		overlinePosition: "overline-position",
		overlineThickness: "overline-thickness",
		paintOrder: "paint-order",
		panose1: "panose-1",
		pointerEvents: "pointer-events",
		referrerPolicy: "referrerpolicy",
		renderingIntent: "rendering-intent",
		shapeRendering: "shape-rendering",
		stopColor: "stop-color",
		stopOpacity: "stop-opacity",
		strikethroughPosition: "strikethrough-position",
		strikethroughThickness: "strikethrough-thickness",
		strokeDashArray: "stroke-dasharray",
		strokeDashOffset: "stroke-dashoffset",
		strokeLineCap: "stroke-linecap",
		strokeLineJoin: "stroke-linejoin",
		strokeMiterLimit: "stroke-miterlimit",
		strokeOpacity: "stroke-opacity",
		strokeWidth: "stroke-width",
		tabIndex: "tabindex",
		textAnchor: "text-anchor",
		textDecoration: "text-decoration",
		textRendering: "text-rendering",
		transformOrigin: "transform-origin",
		typeOf: "typeof",
		underlinePosition: "underline-position",
		underlineThickness: "underline-thickness",
		unicodeBidi: "unicode-bidi",
		unicodeRange: "unicode-range",
		unitsPerEm: "units-per-em",
		vAlphabetic: "v-alphabetic",
		vHanging: "v-hanging",
		vIdeographic: "v-ideographic",
		vMathematical: "v-mathematical",
		vectorEffect: "vector-effect",
		vertAdvY: "vert-adv-y",
		vertOriginX: "vert-origin-x",
		vertOriginY: "vert-origin-y",
		wordSpacing: "word-spacing",
		writingMode: "writing-mode",
		xHeight: "x-height",
		playbackOrder: "playbackorder",
		timelineBegin: "timelinebegin"
	},
	properties: {
		about: M,
		accentHeight: k,
		accumulate: null,
		additive: null,
		alignmentBaseline: null,
		alphabetic: k,
		amplitude: k,
		arabicForm: null,
		ascent: k,
		attributeName: null,
		attributeType: null,
		azimuth: k,
		bandwidth: null,
		baselineShift: null,
		baseFrequency: null,
		baseProfile: null,
		bbox: null,
		begin: null,
		bias: k,
		by: null,
		calcMode: null,
		capHeight: k,
		className: A,
		clip: null,
		clipPath: null,
		clipPathUnits: null,
		clipRule: null,
		color: null,
		colorInterpolation: null,
		colorInterpolationFilters: null,
		colorProfile: null,
		colorRendering: null,
		content: null,
		contentScriptType: null,
		contentStyleType: null,
		crossOrigin: null,
		cursor: null,
		cx: null,
		cy: null,
		d: null,
		dataType: null,
		defaultAction: null,
		descent: k,
		diffuseConstant: k,
		direction: null,
		display: null,
		dur: null,
		divisor: k,
		dominantBaseline: null,
		download: D,
		dx: null,
		dy: null,
		edgeMode: null,
		editable: null,
		elevation: k,
		enableBackground: null,
		end: null,
		event: null,
		exponent: k,
		externalResourcesRequired: null,
		fill: null,
		fillOpacity: k,
		fillRule: null,
		filter: null,
		filterRes: null,
		filterUnits: null,
		floodColor: null,
		floodOpacity: null,
		focusable: null,
		focusHighlight: null,
		fontFamily: null,
		fontSize: null,
		fontSizeAdjust: null,
		fontStretch: null,
		fontStyle: null,
		fontVariant: null,
		fontWeight: null,
		format: null,
		fr: null,
		from: null,
		fx: null,
		fy: null,
		g1: j,
		g2: j,
		glyphName: j,
		glyphOrientationHorizontal: null,
		glyphOrientationVertical: null,
		glyphRef: null,
		gradientTransform: null,
		gradientUnits: null,
		handler: null,
		hanging: k,
		hatchContentUnits: null,
		hatchUnits: null,
		height: null,
		href: null,
		hrefLang: null,
		horizAdvX: k,
		horizOriginX: k,
		horizOriginY: k,
		id: null,
		ideographic: k,
		imageRendering: null,
		initialVisibility: null,
		in: null,
		in2: null,
		intercept: k,
		k,
		k1: k,
		k2: k,
		k3: k,
		k4: k,
		kernelMatrix: M,
		kernelUnitLength: null,
		keyPoints: null,
		keySplines: null,
		keyTimes: null,
		kerning: null,
		lang: null,
		lengthAdjust: null,
		letterSpacing: null,
		lightingColor: null,
		limitingConeAngle: k,
		local: null,
		markerEnd: null,
		markerMid: null,
		markerStart: null,
		markerHeight: null,
		markerUnits: null,
		markerWidth: null,
		mask: null,
		maskContentUnits: null,
		maskType: null,
		maskUnits: null,
		mathematical: null,
		max: null,
		media: null,
		mediaCharacterEncoding: null,
		mediaContentEncodings: null,
		mediaSize: k,
		mediaTime: null,
		method: null,
		min: null,
		mode: null,
		name: null,
		navDown: null,
		navDownLeft: null,
		navDownRight: null,
		navLeft: null,
		navNext: null,
		navPrev: null,
		navRight: null,
		navUp: null,
		navUpLeft: null,
		navUpRight: null,
		numOctaves: null,
		observer: null,
		offset: null,
		onAbort: null,
		onActivate: null,
		onAfterPrint: null,
		onBeforePrint: null,
		onBegin: null,
		onCancel: null,
		onCanPlay: null,
		onCanPlayThrough: null,
		onChange: null,
		onClick: null,
		onClose: null,
		onCopy: null,
		onCueChange: null,
		onCut: null,
		onDblClick: null,
		onDrag: null,
		onDragEnd: null,
		onDragEnter: null,
		onDragExit: null,
		onDragLeave: null,
		onDragOver: null,
		onDragStart: null,
		onDrop: null,
		onDurationChange: null,
		onEmptied: null,
		onEnd: null,
		onEnded: null,
		onError: null,
		onFocus: null,
		onFocusIn: null,
		onFocusOut: null,
		onHashChange: null,
		onInput: null,
		onInvalid: null,
		onKeyDown: null,
		onKeyPress: null,
		onKeyUp: null,
		onLoad: null,
		onLoadedData: null,
		onLoadedMetadata: null,
		onLoadStart: null,
		onMessage: null,
		onMouseDown: null,
		onMouseEnter: null,
		onMouseLeave: null,
		onMouseMove: null,
		onMouseOut: null,
		onMouseOver: null,
		onMouseUp: null,
		onMouseWheel: null,
		onOffline: null,
		onOnline: null,
		onPageHide: null,
		onPageShow: null,
		onPaste: null,
		onPause: null,
		onPlay: null,
		onPlaying: null,
		onPopState: null,
		onProgress: null,
		onRateChange: null,
		onRepeat: null,
		onReset: null,
		onResize: null,
		onScroll: null,
		onSeeked: null,
		onSeeking: null,
		onSelect: null,
		onShow: null,
		onStalled: null,
		onStorage: null,
		onSubmit: null,
		onSuspend: null,
		onTimeUpdate: null,
		onToggle: null,
		onUnload: null,
		onVolumeChange: null,
		onWaiting: null,
		onZoom: null,
		opacity: null,
		operator: null,
		order: null,
		orient: null,
		orientation: null,
		origin: null,
		overflow: null,
		overlay: null,
		overlinePosition: k,
		overlineThickness: k,
		paintOrder: null,
		panose1: null,
		path: null,
		pathLength: k,
		patternContentUnits: null,
		patternTransform: null,
		patternUnits: null,
		phase: null,
		ping: A,
		pitch: null,
		playbackOrder: null,
		pointerEvents: null,
		points: null,
		pointsAtX: k,
		pointsAtY: k,
		pointsAtZ: k,
		preserveAlpha: null,
		preserveAspectRatio: null,
		primitiveUnits: null,
		propagate: null,
		property: M,
		r: null,
		radius: null,
		referrerPolicy: null,
		refX: null,
		refY: null,
		rel: M,
		rev: M,
		renderingIntent: null,
		repeatCount: null,
		repeatDur: null,
		requiredExtensions: M,
		requiredFeatures: M,
		requiredFonts: M,
		requiredFormats: M,
		resource: null,
		restart: null,
		result: null,
		rotate: null,
		rx: null,
		ry: null,
		scale: null,
		seed: null,
		shapeRendering: null,
		side: null,
		slope: null,
		snapshotTime: null,
		specularConstant: k,
		specularExponent: k,
		spreadMethod: null,
		spacing: null,
		startOffset: null,
		stdDeviation: null,
		stemh: null,
		stemv: null,
		stitchTiles: null,
		stopColor: null,
		stopOpacity: null,
		strikethroughPosition: k,
		strikethroughThickness: k,
		string: null,
		stroke: null,
		strokeDashArray: M,
		strokeDashOffset: null,
		strokeLineCap: null,
		strokeLineJoin: null,
		strokeMiterLimit: k,
		strokeOpacity: k,
		strokeWidth: null,
		style: null,
		surfaceScale: k,
		syncBehavior: null,
		syncBehaviorDefault: null,
		syncMaster: null,
		syncTolerance: null,
		syncToleranceDefault: null,
		systemLanguage: M,
		tabIndex: k,
		tableValues: null,
		target: null,
		targetX: k,
		targetY: k,
		textAnchor: null,
		textDecoration: null,
		textRendering: null,
		textLength: null,
		timelineBegin: null,
		title: null,
		transformBehavior: null,
		type: null,
		typeOf: M,
		to: null,
		transform: null,
		transformOrigin: null,
		u1: null,
		u2: null,
		underlinePosition: k,
		underlineThickness: k,
		unicode: null,
		unicodeBidi: null,
		unicodeRange: null,
		unitsPerEm: k,
		values: null,
		vAlphabetic: k,
		vMathematical: k,
		vectorEffect: null,
		vHanging: k,
		vIdeographic: k,
		version: null,
		vertAdvY: k,
		vertOriginX: k,
		vertOriginY: k,
		viewBox: null,
		viewTarget: null,
		visibility: null,
		width: null,
		widths: null,
		wordSpacing: null,
		writingMode: null,
		x: null,
		x1: null,
		x2: null,
		xChannelSelector: null,
		xHeight: k,
		y: null,
		y1: null,
		y2: null,
		yChannelSelector: null,
		z: null,
		zoomAndPan: null
	},
	space: "svg",
	transform: de
}), he = N({
	properties: {
		xLinkActuate: null,
		xLinkArcRole: null,
		xLinkHref: null,
		xLinkRole: null,
		xLinkShow: null,
		xLinkTitle: null,
		xLinkType: null
	},
	space: "xlink",
	transform(e, t) {
		return "xlink:" + t.slice(5).toLowerCase();
	}
}), ge = N({
	attributes: { xmlnsxlink: "xmlns:xlink" },
	properties: {
		xmlnsXLink: null,
		xmlns: null
	},
	space: "xmlns",
	transform: fe
}), _e = N({
	properties: {
		xmlBase: null,
		xmlLang: null,
		xmlSpace: null
	},
	space: "xml",
	transform(e, t) {
		return "xml:" + t.slice(3).toLowerCase();
	}
}), ve = {
	classId: "classID",
	dataType: "datatype",
	itemId: "itemID",
	strokeDashArray: "strokeDasharray",
	strokeDashOffset: "strokeDashoffset",
	strokeLineCap: "strokeLinecap",
	strokeLineJoin: "strokeLinejoin",
	strokeMiterLimit: "strokeMiterlimit",
	typeOf: "typeof",
	xLinkActuate: "xlinkActuate",
	xLinkArcRole: "xlinkArcrole",
	xLinkHref: "xlinkHref",
	xLinkRole: "xlinkRole",
	xLinkShow: "xlinkShow",
	xLinkTitle: "xlinkTitle",
	xLinkType: "xlinkType",
	xmlnsXLink: "xmlnsXlink"
}, ye = /[A-Z]/g, be = /-[a-z]/g, xe = /^data[-\w.:]+$/i;
function Se(e, t) {
	let n = T(t), r = t, i = E;
	if (n in e.normal) return e.property[e.normal[n]];
	if (n.length > 4 && n.slice(0, 4) === "data" && xe.test(t)) {
		if (t.charAt(4) === "-") {
			let e = t.slice(5).replace(be, we);
			r = "data" + e.charAt(0).toUpperCase() + e.slice(1);
		} else {
			let e = t.slice(4);
			if (!be.test(e)) {
				let n = e.replace(ye, Ce);
				n.charAt(0) !== "-" && (n = "-" + n), t = "data" + n;
			}
		}
		i = ce;
	}
	return new i(r, t);
}
function Ce(e) {
	return "-" + e.toLowerCase();
}
function we(e) {
	return e.charAt(1).toUpperCase();
}
//#endregion
//#region node_modules/property-information/index.js
var Te = ne([
	ue,
	pe,
	he,
	ge,
	_e
], "html"), Ee = ne([
	ue,
	me,
	he,
	ge,
	_e
], "svg");
//#endregion
//#region node_modules/space-separated-tokens/index.js
function De(e) {
	return e.join(" ").trim();
}
//#endregion
//#region node_modules/inline-style-parser/cjs/index.js
var Oe = /* @__PURE__ */ o(((e, t) => {
	var n = /\/\*[^*]*\*+([^/*][^*]*\*+)*\//g, r = /\n/g, i = /^\s*/, a = /^(\*?[-#/*\\\w]+(\[[0-9a-z_-]+\])?)\s*/, o = /^:\s*/, s = /^((?:'(?:\\'|.)*?'|"(?:\\"|.)*?"|\([^)]*?\)|[^};])+)/, c = /^[;\s]*/, l = /^\s+|\s+$/g, u = "\n", d = "/", f = "*", p = "", m = "comment", h = "declaration";
	function g(e, t) {
		if (typeof e != "string") throw TypeError("First argument must be a string");
		if (!e) return [];
		t ||= {};
		var l = 1, g = 1;
		function v(e) {
			var t = e.match(r);
			t && (l += t.length);
			var n = e.lastIndexOf(u);
			g = ~n ? e.length - n : g + e.length;
		}
		function y() {
			var e = {
				line: l,
				column: g
			};
			return function(t) {
				return t.position = new b(e), S(), t;
			};
		}
		function b(e) {
			this.start = e, this.end = {
				line: l,
				column: g
			}, this.source = t.source;
		}
		b.prototype.content = e;
		function ee(n) {
			var r = /* @__PURE__ */ Error(t.source + ":" + l + ":" + g + ": " + n);
			if (r.reason = n, r.filename = t.source, r.line = l, r.column = g, r.source = e, !t.silent) throw r;
		}
		function x(t) {
			var n = t.exec(e);
			if (n) {
				var r = n[0];
				return v(r), e = e.slice(r.length), n;
			}
		}
		function S() {
			x(i);
		}
		function te(e) {
			var t;
			for (e ||= []; t = C();) t !== !1 && e.push(t);
			return e;
		}
		function C() {
			var t = y();
			if (!(d != e.charAt(0) || f != e.charAt(1))) {
				for (var n = 2; p != e.charAt(n) && (f != e.charAt(n) || d != e.charAt(n + 1));) ++n;
				if (n += 2, p === e.charAt(n - 1)) return ee("End of comment missing");
				var r = e.slice(2, n - 2);
				return g += 2, v(r), e = e.slice(n), g += 2, t({
					type: m,
					comment: r
				});
			}
		}
		function w() {
			var e = y(), t = x(a);
			if (t) {
				if (C(), !x(o)) return ee("property missing ':'");
				var r = x(s), i = e({
					type: h,
					property: _(t[0].replace(n, p)),
					value: r ? _(r[0].replace(n, p)) : p
				});
				return x(c), i;
			}
		}
		function ne() {
			var e = [];
			te(e);
			for (var t; t = w();) t !== !1 && (e.push(t), te(e));
			return e;
		}
		return S(), ne();
	}
	function _(e) {
		return e ? e.replace(l, p) : p;
	}
	t.exports = g;
})), ke = /* @__PURE__ */ o(((e) => {
	var t = e && e.__importDefault || function(e) {
		return e && e.__esModule ? e : { default: e };
	};
	Object.defineProperty(e, "__esModule", { value: !0 }), e.default = r;
	var n = t(Oe());
	function r(e, t) {
		let r = null;
		if (!e || typeof e != "string") return r;
		let i = (0, n.default)(e), a = typeof t == "function";
		return i.forEach((e) => {
			if (e.type !== "declaration") return;
			let { property: n, value: i } = e;
			a ? t(n, i, e) : i && (r ||= {}, r[n] = i);
		}), r;
	}
})), Ae = /* @__PURE__ */ o(((e) => {
	Object.defineProperty(e, "__esModule", { value: !0 }), e.camelCase = void 0;
	var t = /^--[a-zA-Z0-9_-]+$/, n = /-([a-z])/g, r = /^[^-]+$/, i = /^-(webkit|moz|ms|o|khtml)-/, a = /^-(ms)-/, o = function(e) {
		return !e || r.test(e) || t.test(e);
	}, s = function(e, t) {
		return t.toUpperCase();
	}, c = function(e, t) {
		return `${t}-`;
	};
	e.camelCase = function(e, t) {
		return t === void 0 && (t = {}), o(e) ? e : (e = e.toLowerCase(), e = t.reactCompat ? e.replace(a, c) : e.replace(i, c), e.replace(n, s));
	};
})), je = /* @__PURE__ */ o(((e, t) => {
	var n = (e && e.__importDefault || function(e) {
		return e && e.__esModule ? e : { default: e };
	})(ke()), r = Ae();
	function i(e, t) {
		var i = {};
		return !e || typeof e != "string" || (0, n.default)(e, function(e, n) {
			e && n && (i[(0, r.camelCase)(e, t)] = n);
		}), i;
	}
	i.default = i, t.exports = i;
})), Me = Pe("end"), Ne = Pe("start");
function Pe(e) {
	return t;
	function t(t) {
		let n = t && t.position && t.position[e] || {};
		if (typeof n.line == "number" && n.line > 0 && typeof n.column == "number" && n.column > 0) return {
			line: n.line,
			column: n.column,
			offset: typeof n.offset == "number" && n.offset > -1 ? n.offset : void 0
		};
	}
}
function Fe(e) {
	let t = Ne(e), n = Me(e);
	if (t && n) return {
		start: t,
		end: n
	};
}
//#endregion
//#region node_modules/unist-util-stringify-position/lib/index.js
function Ie(e) {
	return !e || typeof e != "object" ? "" : "position" in e || "type" in e ? Re(e.position) : "start" in e || "end" in e ? Re(e) : "line" in e || "column" in e ? Le(e) : "";
}
function Le(e) {
	return ze(e && e.line) + ":" + ze(e && e.column);
}
function Re(e) {
	return Le(e && e.start) + "-" + Le(e && e.end);
}
function ze(e) {
	return e && typeof e == "number" ? e : 1;
}
//#endregion
//#region node_modules/vfile-message/lib/index.js
var Be = class extends Error {
	constructor(e, t, n) {
		super(), typeof t == "string" && (n = t, t = void 0);
		let r = "", i = {}, a = !1;
		if (t && (i = "line" in t && "column" in t || "start" in t && "end" in t ? { place: t } : "type" in t ? {
			ancestors: [t],
			place: t.position
		} : { ...t }), typeof e == "string" ? r = e : !i.cause && e && (a = !0, r = e.message, i.cause = e), !i.ruleId && !i.source && typeof n == "string") {
			let e = n.indexOf(":");
			e === -1 ? i.ruleId = n : (i.source = n.slice(0, e), i.ruleId = n.slice(e + 1));
		}
		if (!i.place && i.ancestors && i.ancestors) {
			let e = i.ancestors[i.ancestors.length - 1];
			e && (i.place = e.position);
		}
		let o = i.place && "start" in i.place ? i.place.start : i.place;
		this.ancestors = i.ancestors || void 0, this.cause = i.cause || void 0, this.column = o ? o.column : void 0, this.fatal = void 0, this.file = "", this.message = r, this.line = o ? o.line : void 0, this.name = Ie(i.place) || "1:1", this.place = i.place || void 0, this.reason = this.message, this.ruleId = i.ruleId || void 0, this.source = i.source || void 0, this.stack = a && i.cause && typeof i.cause.stack == "string" ? i.cause.stack : "", this.actual = void 0, this.expected = void 0, this.note = void 0, this.url = void 0;
	}
};
Be.prototype.file = "", Be.prototype.name = "", Be.prototype.reason = "", Be.prototype.message = "", Be.prototype.stack = "", Be.prototype.column = void 0, Be.prototype.line = void 0, Be.prototype.ancestors = void 0, Be.prototype.cause = void 0, Be.prototype.fatal = void 0, Be.prototype.place = void 0, Be.prototype.ruleId = void 0, Be.prototype.source = void 0;
//#endregion
//#region node_modules/hast-util-to-jsx-runtime/lib/index.js
var Ve = /* @__PURE__ */ l(je(), 1), He = {}.hasOwnProperty, Ue = /* @__PURE__ */ new Map(), We = /[A-Z]/g, Ge = new Set([
	"table",
	"tbody",
	"thead",
	"tfoot",
	"tr"
]), Ke = new Set(["td", "th"]);
function qe(e, t) {
	if (!t || t.Fragment === void 0) throw TypeError("Expected `Fragment` in options");
	let n = t.filePath || void 0, r;
	if (t.development) {
		if (typeof t.jsxDEV != "function") throw TypeError("Expected `jsxDEV` in options when `development: true`");
		r = it(n, t.jsxDEV);
	} else {
		if (typeof t.jsx != "function") throw TypeError("Expected `jsx` in production options");
		if (typeof t.jsxs != "function") throw TypeError("Expected `jsxs` in production options");
		r = rt(n, t.jsx, t.jsxs);
	}
	let i = {
		Fragment: t.Fragment,
		ancestors: [],
		components: t.components || {},
		create: r,
		elementAttributeNameCase: t.elementAttributeNameCase || "react",
		evaluater: t.createEvaluater ? t.createEvaluater() : void 0,
		filePath: n,
		ignoreInvalidStyle: t.ignoreInvalidStyle || !1,
		passKeys: t.passKeys !== !1,
		passNode: t.passNode || !1,
		schema: t.space === "svg" ? Ee : Te,
		stylePropertyNameCase: t.stylePropertyNameCase || "dom",
		tableCellAlignToStyle: t.tableCellAlignToStyle !== !1
	}, a = Je(i, e, void 0);
	return a && typeof a != "string" ? a : i.create(e, i.Fragment, { children: a || void 0 }, void 0);
}
function Je(e, t, n) {
	if (t.type === "element") return Ye(e, t, n);
	if (t.type === "mdxFlowExpression" || t.type === "mdxTextExpression") return Xe(e, t);
	if (t.type === "mdxJsxFlowElement" || t.type === "mdxJsxTextElement") return Qe(e, t, n);
	if (t.type === "mdxjsEsm") return Ze(e, t);
	if (t.type === "root") return $e(e, t, n);
	if (t.type === "text") return et(e, t);
}
function Ye(e, t, n) {
	let r = e.schema, i = r;
	t.tagName.toLowerCase() === "svg" && r.space === "html" && (i = Ee, e.schema = i), e.ancestors.push(t);
	let a = ut(e, t.tagName, !1), o = at(e, t), s = st(e, t);
	return Ge.has(t.tagName) && (s = s.filter(function(e) {
		return typeof e == "string" ? !te(e) : !0;
	})), tt(e, o, a, t), nt(o, s), e.ancestors.pop(), e.schema = r, e.create(t, a, o, n);
}
function Xe(e, t) {
	if (t.data && t.data.estree && e.evaluater) {
		let n = t.data.estree.body[0];
		return n.type, e.evaluater.evaluateExpression(n.expression);
	}
	dt(e, t.position);
}
function Ze(e, t) {
	if (t.data && t.data.estree && e.evaluater) return e.evaluater.evaluateProgram(t.data.estree);
	dt(e, t.position);
}
function Qe(e, t, n) {
	let r = e.schema, i = r;
	t.name === "svg" && r.space === "html" && (i = Ee, e.schema = i), e.ancestors.push(t);
	let a = t.name === null ? e.Fragment : ut(e, t.name, !0), o = ot(e, t), s = st(e, t);
	return tt(e, o, a, t), nt(o, s), e.ancestors.pop(), e.schema = r, e.create(t, a, o, n);
}
function $e(e, t, n) {
	let r = {};
	return nt(r, st(e, t)), e.create(t, e.Fragment, r, n);
}
function et(e, t) {
	return t.value;
}
function tt(e, t, n, r) {
	typeof n != "string" && n !== e.Fragment && e.passNode && (t.node = r);
}
function nt(e, t) {
	if (t.length > 0) {
		let n = t.length > 1 ? t : t[0];
		n && (e.children = n);
	}
}
function rt(e, t, n) {
	return r;
	function r(e, r, i, a) {
		let o = Array.isArray(i.children) ? n : t;
		return a ? o(r, i, a) : o(r, i);
	}
}
function it(e, t) {
	return n;
	function n(n, r, i, a) {
		let o = Array.isArray(i.children), s = Ne(n);
		return t(r, i, a, o, {
			columnNumber: s ? s.column - 1 : void 0,
			fileName: e,
			lineNumber: s ? s.line : void 0
		}, void 0);
	}
}
function at(e, t) {
	let n = {}, r, i;
	for (i in t.properties) if (i !== "children" && He.call(t.properties, i)) {
		let a = ct(e, i, t.properties[i]);
		if (a) {
			let [i, o] = a;
			e.tableCellAlignToStyle && i === "align" && typeof o == "string" && Ke.has(t.tagName) ? r = o : n[i] = o;
		}
	}
	if (r) {
		let t = n.style ||= {};
		t[e.stylePropertyNameCase === "css" ? "text-align" : "textAlign"] = r;
	}
	return n;
}
function ot(e, t) {
	let n = {};
	for (let r of t.attributes) if (r.type === "mdxJsxExpressionAttribute") if (r.data && r.data.estree && e.evaluater) {
		let t = r.data.estree.body[0];
		t.type;
		let i = t.expression;
		i.type;
		let a = i.properties[0];
		a.type, Object.assign(n, e.evaluater.evaluateExpression(a.argument));
	} else dt(e, t.position);
	else {
		let i = r.name, a;
		if (r.value && typeof r.value == "object") if (r.value.data && r.value.data.estree && e.evaluater) {
			let t = r.value.data.estree.body[0];
			t.type, a = e.evaluater.evaluateExpression(t.expression);
		} else dt(e, t.position);
		else a = r.value === null ? !0 : r.value;
		n[i] = a;
	}
	return n;
}
function st(e, t) {
	let n = [], r = -1, i = e.passKeys ? /* @__PURE__ */ new Map() : Ue;
	for (; ++r < t.children.length;) {
		let a = t.children[r], o;
		if (e.passKeys) {
			let e = a.type === "element" ? a.tagName : a.type === "mdxJsxFlowElement" || a.type === "mdxJsxTextElement" ? a.name : void 0;
			if (e) {
				let t = i.get(e) || 0;
				o = e + "-" + t, i.set(e, t + 1);
			}
		}
		let s = Je(e, a, o);
		s !== void 0 && n.push(s);
	}
	return n;
}
function ct(e, t, n) {
	let r = Se(e.schema, t);
	if (!(n == null || typeof n == "number" && Number.isNaN(n))) {
		if (Array.isArray(n) && (n = r.commaSeparated ? v(n) : De(n)), r.property === "style") {
			let t = typeof n == "object" ? n : lt(e, String(n));
			return e.stylePropertyNameCase === "css" && (t = ft(t)), ["style", t];
		}
		return [e.elementAttributeNameCase === "react" && r.space ? ve[r.property] || r.property : r.attribute, n];
	}
}
function lt(e, t) {
	try {
		return (0, Ve.default)(t, { reactCompat: !0 });
	} catch (t) {
		if (e.ignoreInvalidStyle) return {};
		let n = t, r = new Be("Cannot parse `style` attribute", {
			ancestors: e.ancestors,
			cause: n,
			ruleId: "style",
			source: "hast-util-to-jsx-runtime"
		});
		throw r.file = e.filePath || void 0, r.url = "https://github.com/syntax-tree/hast-util-to-jsx-runtime#cannot-parse-style-attribute", r;
	}
}
function ut(e, t, n) {
	let r;
	if (!n) r = {
		type: "Literal",
		value: t
	};
	else if (t.includes(".")) {
		let e = t.split("."), n = -1, i;
		for (; ++n < e.length;) {
			let t = x(e[n]) ? {
				type: "Identifier",
				name: e[n]
			} : {
				type: "Literal",
				value: e[n]
			};
			i = i ? {
				type: "MemberExpression",
				object: i,
				property: t,
				computed: !!(n && t.type === "Literal"),
				optional: !1
			} : t;
		}
		r = i;
	} else r = x(t) && !/^[a-z]/.test(t) ? {
		type: "Identifier",
		name: t
	} : {
		type: "Literal",
		value: t
	};
	if (r.type === "Literal") {
		let t = r.value;
		return He.call(e.components, t) ? e.components[t] : t;
	}
	if (e.evaluater) return e.evaluater.evaluateExpression(r);
	dt(e);
}
function dt(e, t) {
	let n = new Be("Cannot handle MDX estrees without `createEvaluater`", {
		ancestors: e.ancestors,
		place: t,
		ruleId: "mdx-estree",
		source: "hast-util-to-jsx-runtime"
	});
	throw n.file = e.filePath || void 0, n.url = "https://github.com/syntax-tree/hast-util-to-jsx-runtime#cannot-handle-mdx-estrees-without-createevaluater", n;
}
function ft(e) {
	let t = {}, n;
	for (n in e) He.call(e, n) && (t[pt(n)] = e[n]);
	return t;
}
function pt(e) {
	let t = e.replace(We, mt);
	return t.slice(0, 3) === "ms-" && (t = "-" + t), t;
}
function mt(e) {
	return "-" + e.toLowerCase();
}
//#endregion
//#region node_modules/html-url-attributes/lib/index.js
var ht = {
	action: ["form"],
	cite: [
		"blockquote",
		"del",
		"ins",
		"q"
	],
	data: ["object"],
	formAction: ["button", "input"],
	href: [
		"a",
		"area",
		"base",
		"link"
	],
	icon: ["menuitem"],
	itemId: null,
	manifest: ["html"],
	ping: ["a", "area"],
	poster: ["video"],
	src: [
		"audio",
		"embed",
		"iframe",
		"img",
		"input",
		"script",
		"source",
		"track",
		"video"
	]
}, gt = /* @__PURE__ */ o(((e) => {
	var t = Symbol.for("react.transitional.element"), n = Symbol.for("react.fragment");
	function r(e, n, r) {
		var i = null;
		if (r !== void 0 && (i = "" + r), n.key !== void 0 && (i = "" + n.key), "key" in n) for (var a in r = {}, n) a !== "key" && (r[a] = n[a]);
		else r = n;
		return n = r.ref, {
			$$typeof: t,
			type: e,
			key: i,
			ref: n === void 0 ? null : n,
			props: r
		};
	}
	e.Fragment = n, e.jsx = r, e.jsxs = r;
})), _t = /* @__PURE__ */ o(((e, t) => {
	t.exports = gt();
})), vt = {};
function yt(e, t) {
	let n = t || vt;
	return bt(e, typeof n.includeImageAlt == "boolean" ? n.includeImageAlt : !0, typeof n.includeHtml == "boolean" ? n.includeHtml : !0);
}
function bt(e, t, n) {
	if (St(e)) {
		if ("value" in e) return e.type === "html" && !n ? "" : e.value;
		if (t && "alt" in e && e.alt) return e.alt;
		if ("children" in e) return xt(e.children, t, n);
	}
	return Array.isArray(e) ? xt(e, t, n) : "";
}
function xt(e, t, n) {
	let r = [], i = -1;
	for (; ++i < e.length;) r[i] = bt(e[i], t, n);
	return r.join("");
}
function St(e) {
	return !!(e && typeof e == "object");
}
//#endregion
//#region node_modules/decode-named-character-reference/index.dom.js
var Ct = document.createElement("i");
function wt(e) {
	let t = "&" + e + ";";
	Ct.innerHTML = t;
	let n = Ct.textContent;
	return n.charCodeAt(n.length - 1) === 59 && e !== "semi" || n === t ? !1 : n;
}
//#endregion
//#region node_modules/micromark-util-chunked/index.js
function Tt(e, t, n, r) {
	let i = e.length, a = 0, o;
	if (t = t < 0 ? -t > i ? 0 : i + t : t > i ? i : t, n = n > 0 ? n : 0, r.length < 1e4) o = Array.from(r), o.unshift(t, n), e.splice(...o);
	else for (n && e.splice(t, n); a < r.length;) o = r.slice(a, a + 1e4), o.unshift(t, 0), e.splice(...o), a += 1e4, t += 1e4;
}
function Et(e, t) {
	return e.length > 0 ? (Tt(e, e.length, 0, t), e) : t;
}
//#endregion
//#region node_modules/micromark-util-combine-extensions/index.js
var Dt = {}.hasOwnProperty;
function Ot(e) {
	let t = {}, n = -1;
	for (; ++n < e.length;) kt(t, e[n]);
	return t;
}
function kt(e, t) {
	let n;
	for (n in t) {
		let r = (Dt.call(e, n) ? e[n] : void 0) || (e[n] = {}), i = t[n], a;
		if (i) for (a in i) {
			Dt.call(r, a) || (r[a] = []);
			let e = i[a];
			At(r[a], Array.isArray(e) ? e : e ? [e] : []);
		}
	}
}
function At(e, t) {
	let n = -1, r = [];
	for (; ++n < t.length;) (t[n].add === "after" ? e : r).push(t[n]);
	Tt(e, 0, 0, r);
}
//#endregion
//#region node_modules/micromark-util-decode-numeric-character-reference/index.js
function jt(e, t) {
	let n = Number.parseInt(e, t);
	return n < 9 || n === 11 || n > 13 && n < 32 || n > 126 && n < 160 || n > 55295 && n < 57344 || n > 64975 && n < 65008 || (n & 65535) == 65535 || (n & 65535) == 65534 || n > 1114111 ? "�" : String.fromCodePoint(n);
}
//#endregion
//#region node_modules/micromark-util-normalize-identifier/index.js
function Mt(e) {
	return e.replace(/[\t\n\r ]+/g, " ").replace(/^ | $/g, "").toLowerCase().toUpperCase();
}
//#endregion
//#region node_modules/micromark-util-character/index.js
var Nt = Ht(/[A-Za-z]/), Pt = Ht(/[\dA-Za-z]/), Ft = Ht(/[#-'*+\--9=?A-Z^-~]/);
function It(e) {
	return e !== null && (e < 32 || e === 127);
}
var Lt = Ht(/\d/), Rt = Ht(/[\dA-Fa-f]/), zt = Ht(/[!-/:-@[-`{-~]/);
function P(e) {
	return e !== null && e < -2;
}
function F(e) {
	return e !== null && (e < 0 || e === 32);
}
function I(e) {
	return e === -2 || e === -1 || e === 32;
}
var Bt = Ht(/\p{P}|\p{S}/u), Vt = Ht(/\s/);
function Ht(e) {
	return t;
	function t(t) {
		return t !== null && t > -1 && e.test(String.fromCharCode(t));
	}
}
//#endregion
//#region node_modules/micromark-util-sanitize-uri/index.js
function Ut(e) {
	let t = [], n = -1, r = 0, i = 0;
	for (; ++n < e.length;) {
		let a = e.charCodeAt(n), o = "";
		if (a === 37 && Pt(e.charCodeAt(n + 1)) && Pt(e.charCodeAt(n + 2))) i = 2;
		else if (a < 128) /[!#$&-;=?-Z_a-z~]/.test(String.fromCharCode(a)) || (o = String.fromCharCode(a));
		else if (a > 55295 && a < 57344) {
			let t = e.charCodeAt(n + 1);
			a < 56320 && t > 56319 && t < 57344 ? (o = String.fromCharCode(a, t), i = 1) : o = "�";
		} else o = String.fromCharCode(a);
		o &&= (t.push(e.slice(r, n), encodeURIComponent(o)), r = n + i + 1, ""), i &&= (n += i, 0);
	}
	return t.join("") + e.slice(r);
}
//#endregion
//#region node_modules/micromark-factory-space/index.js
function L(e, t, n, r) {
	let i = r ? r - 1 : Infinity, a = 0;
	return o;
	function o(r) {
		return I(r) ? (e.enter(n), s(r)) : t(r);
	}
	function s(r) {
		return I(r) && a++ < i ? (e.consume(r), s) : (e.exit(n), t(r));
	}
}
//#endregion
//#region node_modules/micromark/lib/initialize/content.js
var Wt = { tokenize: Gt };
function Gt(e) {
	let t = e.attempt(this.parser.constructs.contentInitial, r, i), n;
	return t;
	function r(n) {
		if (n === null) {
			e.consume(n);
			return;
		}
		return e.enter("lineEnding"), e.consume(n), e.exit("lineEnding"), L(e, t, "linePrefix");
	}
	function i(t) {
		return e.enter("paragraph"), a(t);
	}
	function a(t) {
		let r = e.enter("chunkText", {
			contentType: "text",
			previous: n
		});
		return n && (n.next = r), n = r, o(t);
	}
	function o(t) {
		if (t === null) {
			e.exit("chunkText"), e.exit("paragraph"), e.consume(t);
			return;
		}
		return P(t) ? (e.consume(t), e.exit("chunkText"), a) : (e.consume(t), o);
	}
}
//#endregion
//#region node_modules/micromark/lib/initialize/document.js
var Kt = { tokenize: Jt }, qt = { tokenize: Yt };
function Jt(e) {
	let t = this, n = [], r = 0, i, a, o;
	return s;
	function s(i) {
		if (r < n.length) {
			let a = n[r];
			return t.containerState = a[1], e.attempt(a[0].continuation, c, l)(i);
		}
		return l(i);
	}
	function c(e) {
		if (r++, t.containerState._closeFlow) {
			t.containerState._closeFlow = void 0, i && v();
			let n = t.events.length, a = n, o;
			for (; a--;) if (t.events[a][0] === "exit" && t.events[a][1].type === "chunkFlow") {
				o = t.events[a][1].end;
				break;
			}
			_(r);
			let s = n;
			for (; s < t.events.length;) t.events[s][1].end = { ...o }, s++;
			return Tt(t.events, a + 1, 0, t.events.slice(n)), t.events.length = s, l(e);
		}
		return s(e);
	}
	function l(a) {
		if (r === n.length) {
			if (!i) return f(a);
			if (i.currentConstruct && i.currentConstruct.concrete) return m(a);
			t.interrupt = !!(i.currentConstruct && !i._gfmTableDynamicInterruptHack);
		}
		return t.containerState = {}, e.check(qt, u, d)(a);
	}
	function u(e) {
		return i && v(), _(r), f(e);
	}
	function d(e) {
		return t.parser.lazy[t.now().line] = r !== n.length, o = t.now().offset, m(e);
	}
	function f(n) {
		return t.containerState = {}, e.attempt(qt, p, m)(n);
	}
	function p(e) {
		return r++, n.push([t.currentConstruct, t.containerState]), f(e);
	}
	function m(n) {
		if (n === null) {
			i && v(), _(0), e.consume(n);
			return;
		}
		return i ||= t.parser.flow(t.now()), e.enter("chunkFlow", {
			_tokenizer: i,
			contentType: "flow",
			previous: a
		}), h(n);
	}
	function h(n) {
		if (n === null) {
			g(e.exit("chunkFlow"), !0), _(0), e.consume(n);
			return;
		}
		return P(n) ? (e.consume(n), g(e.exit("chunkFlow")), r = 0, t.interrupt = void 0, s) : (e.consume(n), h);
	}
	function g(e, n) {
		let s = t.sliceStream(e);
		if (n && s.push(null), e.previous = a, a && (a.next = e), a = e, i.defineSkip(e.start), i.write(s), t.parser.lazy[e.start.line]) {
			let e = i.events.length;
			for (; e--;) if (i.events[e][1].start.offset < o && (!i.events[e][1].end || i.events[e][1].end.offset > o)) return;
			let n = t.events.length, a = n, s, c;
			for (; a--;) if (t.events[a][0] === "exit" && t.events[a][1].type === "chunkFlow") {
				if (s) {
					c = t.events[a][1].end;
					break;
				}
				s = !0;
			}
			for (_(r), e = n; e < t.events.length;) t.events[e][1].end = { ...c }, e++;
			Tt(t.events, a + 1, 0, t.events.slice(n)), t.events.length = e;
		}
	}
	function _(r) {
		let i = n.length;
		for (; i-- > r;) {
			let r = n[i];
			t.containerState = r[1], r[0].exit.call(t, e);
		}
		n.length = r;
	}
	function v() {
		i.write([null]), a = void 0, i = void 0, t.containerState._closeFlow = void 0;
	}
}
function Yt(e, t, n) {
	return L(e, e.attempt(this.parser.constructs.document, t, n), "linePrefix", this.parser.constructs.disable.null.includes("codeIndented") ? void 0 : 4);
}
//#endregion
//#region node_modules/micromark-util-classify-character/index.js
function Xt(e) {
	if (e === null || F(e) || Vt(e)) return 1;
	if (Bt(e)) return 2;
}
//#endregion
//#region node_modules/micromark-util-resolve-all/index.js
function Zt(e, t, n) {
	let r = [], i = -1;
	for (; ++i < e.length;) {
		let a = e[i].resolveAll;
		a && !r.includes(a) && (t = a(t, n), r.push(a));
	}
	return t;
}
//#endregion
//#region node_modules/micromark-core-commonmark/lib/attention.js
var Qt = {
	name: "attention",
	resolveAll: $t,
	tokenize: en
};
function $t(e, t) {
	let n = -1, r, i, a, o, s, c, l, u;
	for (; ++n < e.length;) if (e[n][0] === "enter" && e[n][1].type === "attentionSequence" && e[n][1]._close) {
		for (r = n; r--;) if (e[r][0] === "exit" && e[r][1].type === "attentionSequence" && e[r][1]._open && t.sliceSerialize(e[r][1]).charCodeAt(0) === t.sliceSerialize(e[n][1]).charCodeAt(0)) {
			if ((e[r][1]._close || e[n][1]._open) && (e[n][1].end.offset - e[n][1].start.offset) % 3 && !((e[r][1].end.offset - e[r][1].start.offset + e[n][1].end.offset - e[n][1].start.offset) % 3)) continue;
			c = e[r][1].end.offset - e[r][1].start.offset > 1 && e[n][1].end.offset - e[n][1].start.offset > 1 ? 2 : 1;
			let d = { ...e[r][1].end }, f = { ...e[n][1].start };
			tn(d, -c), tn(f, c), o = {
				type: c > 1 ? "strongSequence" : "emphasisSequence",
				start: d,
				end: { ...e[r][1].end }
			}, s = {
				type: c > 1 ? "strongSequence" : "emphasisSequence",
				start: { ...e[n][1].start },
				end: f
			}, a = {
				type: c > 1 ? "strongText" : "emphasisText",
				start: { ...e[r][1].end },
				end: { ...e[n][1].start }
			}, i = {
				type: c > 1 ? "strong" : "emphasis",
				start: { ...o.start },
				end: { ...s.end }
			}, e[r][1].end = { ...o.start }, e[n][1].start = { ...s.end }, l = [], e[r][1].end.offset - e[r][1].start.offset && (l = Et(l, [[
				"enter",
				e[r][1],
				t
			], [
				"exit",
				e[r][1],
				t
			]])), l = Et(l, [
				[
					"enter",
					i,
					t
				],
				[
					"enter",
					o,
					t
				],
				[
					"exit",
					o,
					t
				],
				[
					"enter",
					a,
					t
				]
			]), l = Et(l, Zt(t.parser.constructs.insideSpan.null, e.slice(r + 1, n), t)), l = Et(l, [
				[
					"exit",
					a,
					t
				],
				[
					"enter",
					s,
					t
				],
				[
					"exit",
					s,
					t
				],
				[
					"exit",
					i,
					t
				]
			]), e[n][1].end.offset - e[n][1].start.offset ? (u = 2, l = Et(l, [[
				"enter",
				e[n][1],
				t
			], [
				"exit",
				e[n][1],
				t
			]])) : u = 0, Tt(e, r - 1, n - r + 3, l), n = r + l.length - u - 2;
			break;
		}
	}
	for (n = -1; ++n < e.length;) e[n][1].type === "attentionSequence" && (e[n][1].type = "data");
	return e;
}
function en(e, t) {
	let n = this.parser.constructs.attentionMarkers.null, r = this.previous, i = Xt(r), a;
	return o;
	function o(t) {
		return a = t, e.enter("attentionSequence"), s(t);
	}
	function s(o) {
		if (o === a) return e.consume(o), s;
		let c = e.exit("attentionSequence"), l = Xt(o), u = !l || l === 2 && i || n.includes(o), d = !i || i === 2 && l || n.includes(r);
		return c._open = !!(a === 42 ? u : u && (i || !d)), c._close = !!(a === 42 ? d : d && (l || !u)), t(o);
	}
}
function tn(e, t) {
	e.column += t, e.offset += t, e._bufferIndex += t;
}
//#endregion
//#region node_modules/micromark-core-commonmark/lib/autolink.js
var nn = {
	name: "autolink",
	tokenize: rn
};
function rn(e, t, n) {
	let r = 0;
	return i;
	function i(t) {
		return e.enter("autolink"), e.enter("autolinkMarker"), e.consume(t), e.exit("autolinkMarker"), e.enter("autolinkProtocol"), a;
	}
	function a(t) {
		return Nt(t) ? (e.consume(t), o) : t === 64 ? n(t) : l(t);
	}
	function o(e) {
		return e === 43 || e === 45 || e === 46 || Pt(e) ? (r = 1, s(e)) : l(e);
	}
	function s(t) {
		return t === 58 ? (e.consume(t), r = 0, c) : (t === 43 || t === 45 || t === 46 || Pt(t)) && r++ < 32 ? (e.consume(t), s) : (r = 0, l(t));
	}
	function c(r) {
		return r === 62 ? (e.exit("autolinkProtocol"), e.enter("autolinkMarker"), e.consume(r), e.exit("autolinkMarker"), e.exit("autolink"), t) : r === null || r === 32 || r === 60 || It(r) ? n(r) : (e.consume(r), c);
	}
	function l(t) {
		return t === 64 ? (e.consume(t), u) : Ft(t) ? (e.consume(t), l) : n(t);
	}
	function u(e) {
		return Pt(e) ? d(e) : n(e);
	}
	function d(n) {
		return n === 46 ? (e.consume(n), r = 0, u) : n === 62 ? (e.exit("autolinkProtocol").type = "autolinkEmail", e.enter("autolinkMarker"), e.consume(n), e.exit("autolinkMarker"), e.exit("autolink"), t) : f(n);
	}
	function f(t) {
		if ((t === 45 || Pt(t)) && r++ < 63) {
			let n = t === 45 ? f : d;
			return e.consume(t), n;
		}
		return n(t);
	}
}
//#endregion
//#region node_modules/micromark-core-commonmark/lib/blank-line.js
var an = {
	partial: !0,
	tokenize: on
};
function on(e, t, n) {
	return r;
	function r(t) {
		return I(t) ? L(e, i, "linePrefix")(t) : i(t);
	}
	function i(e) {
		return e === null || P(e) ? t(e) : n(e);
	}
}
//#endregion
//#region node_modules/micromark-core-commonmark/lib/block-quote.js
var sn = {
	continuation: { tokenize: ln },
	exit: un,
	name: "blockQuote",
	tokenize: cn
};
function cn(e, t, n) {
	let r = this;
	return i;
	function i(t) {
		if (t === 62) {
			let n = r.containerState;
			return n.open ||= (e.enter("blockQuote", { _container: !0 }), !0), e.enter("blockQuotePrefix"), e.enter("blockQuoteMarker"), e.consume(t), e.exit("blockQuoteMarker"), a;
		}
		return n(t);
	}
	function a(n) {
		return I(n) ? (e.enter("blockQuotePrefixWhitespace"), e.consume(n), e.exit("blockQuotePrefixWhitespace"), e.exit("blockQuotePrefix"), t) : (e.exit("blockQuotePrefix"), t(n));
	}
}
function ln(e, t, n) {
	let r = this;
	return i;
	function i(t) {
		return I(t) ? L(e, a, "linePrefix", r.parser.constructs.disable.null.includes("codeIndented") ? void 0 : 4)(t) : a(t);
	}
	function a(r) {
		return e.attempt(sn, t, n)(r);
	}
}
function un(e) {
	e.exit("blockQuote");
}
//#endregion
//#region node_modules/micromark-core-commonmark/lib/character-escape.js
var dn = {
	name: "characterEscape",
	tokenize: fn
};
function fn(e, t, n) {
	return r;
	function r(t) {
		return e.enter("characterEscape"), e.enter("escapeMarker"), e.consume(t), e.exit("escapeMarker"), i;
	}
	function i(r) {
		return zt(r) ? (e.enter("characterEscapeValue"), e.consume(r), e.exit("characterEscapeValue"), e.exit("characterEscape"), t) : n(r);
	}
}
//#endregion
//#region node_modules/micromark-core-commonmark/lib/character-reference.js
var pn = {
	name: "characterReference",
	tokenize: mn
};
function mn(e, t, n) {
	let r = this, i = 0, a, o;
	return s;
	function s(t) {
		return e.enter("characterReference"), e.enter("characterReferenceMarker"), e.consume(t), e.exit("characterReferenceMarker"), c;
	}
	function c(t) {
		return t === 35 ? (e.enter("characterReferenceMarkerNumeric"), e.consume(t), e.exit("characterReferenceMarkerNumeric"), l) : (e.enter("characterReferenceValue"), a = 31, o = Pt, u(t));
	}
	function l(t) {
		return t === 88 || t === 120 ? (e.enter("characterReferenceMarkerHexadecimal"), e.consume(t), e.exit("characterReferenceMarkerHexadecimal"), e.enter("characterReferenceValue"), a = 6, o = Rt, u) : (e.enter("characterReferenceValue"), a = 7, o = Lt, u(t));
	}
	function u(s) {
		if (s === 59 && i) {
			let i = e.exit("characterReferenceValue");
			return o === Pt && !wt(r.sliceSerialize(i)) ? n(s) : (e.enter("characterReferenceMarker"), e.consume(s), e.exit("characterReferenceMarker"), e.exit("characterReference"), t);
		}
		return o(s) && i++ < a ? (e.consume(s), u) : n(s);
	}
}
//#endregion
//#region node_modules/micromark-core-commonmark/lib/code-fenced.js
var hn = {
	partial: !0,
	tokenize: vn
}, gn = {
	concrete: !0,
	name: "codeFenced",
	tokenize: _n
};
function _n(e, t, n) {
	let r = this, i = {
		partial: !0,
		tokenize: ee
	}, a = 0, o = 0, s;
	return c;
	function c(e) {
		return l(e);
	}
	function l(t) {
		let n = r.events[r.events.length - 1];
		return a = n && n[1].type === "linePrefix" ? n[2].sliceSerialize(n[1], !0).length : 0, s = t, e.enter("codeFenced"), e.enter("codeFencedFence"), e.enter("codeFencedFenceSequence"), u(t);
	}
	function u(t) {
		return t === s ? (o++, e.consume(t), u) : o < 3 ? n(t) : (e.exit("codeFencedFenceSequence"), I(t) ? L(e, d, "whitespace")(t) : d(t));
	}
	function d(n) {
		return n === null || P(n) ? (e.exit("codeFencedFence"), r.interrupt ? t(n) : e.check(hn, h, b)(n)) : (e.enter("codeFencedFenceInfo"), e.enter("chunkString", { contentType: "string" }), f(n));
	}
	function f(t) {
		return t === null || P(t) ? (e.exit("chunkString"), e.exit("codeFencedFenceInfo"), d(t)) : I(t) ? (e.exit("chunkString"), e.exit("codeFencedFenceInfo"), L(e, p, "whitespace")(t)) : t === 96 && t === s ? n(t) : (e.consume(t), f);
	}
	function p(t) {
		return t === null || P(t) ? d(t) : (e.enter("codeFencedFenceMeta"), e.enter("chunkString", { contentType: "string" }), m(t));
	}
	function m(t) {
		return t === null || P(t) ? (e.exit("chunkString"), e.exit("codeFencedFenceMeta"), d(t)) : t === 96 && t === s ? n(t) : (e.consume(t), m);
	}
	function h(t) {
		return e.attempt(i, b, g)(t);
	}
	function g(t) {
		return e.enter("lineEnding"), e.consume(t), e.exit("lineEnding"), _;
	}
	function _(t) {
		return a > 0 && I(t) ? L(e, v, "linePrefix", a + 1)(t) : v(t);
	}
	function v(t) {
		return t === null || P(t) ? e.check(hn, h, b)(t) : (e.enter("codeFlowValue"), y(t));
	}
	function y(t) {
		return t === null || P(t) ? (e.exit("codeFlowValue"), v(t)) : (e.consume(t), y);
	}
	function b(n) {
		return e.exit("codeFenced"), t(n);
	}
	function ee(e, t, n) {
		let i = 0;
		return a;
		function a(t) {
			return e.enter("lineEnding"), e.consume(t), e.exit("lineEnding"), c;
		}
		function c(t) {
			return e.enter("codeFencedFence"), I(t) ? L(e, l, "linePrefix", r.parser.constructs.disable.null.includes("codeIndented") ? void 0 : 4)(t) : l(t);
		}
		function l(t) {
			return t === s ? (e.enter("codeFencedFenceSequence"), u(t)) : n(t);
		}
		function u(t) {
			return t === s ? (i++, e.consume(t), u) : i >= o ? (e.exit("codeFencedFenceSequence"), I(t) ? L(e, d, "whitespace")(t) : d(t)) : n(t);
		}
		function d(r) {
			return r === null || P(r) ? (e.exit("codeFencedFence"), t(r)) : n(r);
		}
	}
}
function vn(e, t, n) {
	let r = this;
	return i;
	function i(t) {
		return t === null ? n(t) : (e.enter("lineEnding"), e.consume(t), e.exit("lineEnding"), a);
	}
	function a(e) {
		return r.parser.lazy[r.now().line] ? n(e) : t(e);
	}
}
//#endregion
//#region node_modules/micromark-core-commonmark/lib/code-indented.js
var yn = {
	name: "codeIndented",
	tokenize: xn
}, bn = {
	partial: !0,
	tokenize: Sn
};
function xn(e, t, n) {
	let r = this;
	return i;
	function i(t) {
		return e.enter("codeIndented"), L(e, a, "linePrefix", 5)(t);
	}
	function a(e) {
		let t = r.events[r.events.length - 1];
		return t && t[1].type === "linePrefix" && t[2].sliceSerialize(t[1], !0).length >= 4 ? o(e) : n(e);
	}
	function o(t) {
		return t === null ? c(t) : P(t) ? e.attempt(bn, o, c)(t) : (e.enter("codeFlowValue"), s(t));
	}
	function s(t) {
		return t === null || P(t) ? (e.exit("codeFlowValue"), o(t)) : (e.consume(t), s);
	}
	function c(n) {
		return e.exit("codeIndented"), t(n);
	}
}
function Sn(e, t, n) {
	let r = this;
	return i;
	function i(t) {
		return r.parser.lazy[r.now().line] ? n(t) : P(t) ? (e.enter("lineEnding"), e.consume(t), e.exit("lineEnding"), i) : L(e, a, "linePrefix", 5)(t);
	}
	function a(e) {
		let a = r.events[r.events.length - 1];
		return a && a[1].type === "linePrefix" && a[2].sliceSerialize(a[1], !0).length >= 4 ? t(e) : P(e) ? i(e) : n(e);
	}
}
//#endregion
//#region node_modules/micromark-core-commonmark/lib/code-text.js
var Cn = {
	name: "codeText",
	previous: Tn,
	resolve: wn,
	tokenize: En
};
function wn(e) {
	let t = e.length - 4, n = 3, r, i;
	if ((e[n][1].type === "lineEnding" || e[n][1].type === "space") && (e[t][1].type === "lineEnding" || e[t][1].type === "space")) {
		for (r = n; ++r < t;) if (e[r][1].type === "codeTextData") {
			e[n][1].type = "codeTextPadding", e[t][1].type = "codeTextPadding", n += 2, t -= 2;
			break;
		}
	}
	for (r = n - 1, t++; ++r <= t;) i === void 0 ? r !== t && e[r][1].type !== "lineEnding" && (i = r) : (r === t || e[r][1].type === "lineEnding") && (e[i][1].type = "codeTextData", r !== i + 2 && (e[i][1].end = e[r - 1][1].end, e.splice(i + 2, r - i - 2), t -= r - i - 2, r = i + 2), i = void 0);
	return e;
}
function Tn(e) {
	return e !== 96 || this.events[this.events.length - 1][1].type === "characterEscape";
}
function En(e, t, n) {
	let r = 0, i, a;
	return o;
	function o(t) {
		return e.enter("codeText"), e.enter("codeTextSequence"), s(t);
	}
	function s(t) {
		return t === 96 ? (e.consume(t), r++, s) : (e.exit("codeTextSequence"), c(t));
	}
	function c(t) {
		return t === null ? n(t) : t === 32 ? (e.enter("space"), e.consume(t), e.exit("space"), c) : t === 96 ? (a = e.enter("codeTextSequence"), i = 0, u(t)) : P(t) ? (e.enter("lineEnding"), e.consume(t), e.exit("lineEnding"), c) : (e.enter("codeTextData"), l(t));
	}
	function l(t) {
		return t === null || t === 32 || t === 96 || P(t) ? (e.exit("codeTextData"), c(t)) : (e.consume(t), l);
	}
	function u(n) {
		return n === 96 ? (e.consume(n), i++, u) : i === r ? (e.exit("codeTextSequence"), e.exit("codeText"), t(n)) : (a.type = "codeTextData", l(n));
	}
}
//#endregion
//#region node_modules/micromark-util-subtokenize/lib/splice-buffer.js
var Dn = class {
	constructor(e) {
		this.left = e ? [...e] : [], this.right = [];
	}
	get(e) {
		if (e < 0 || e >= this.left.length + this.right.length) throw RangeError("Cannot access index `" + e + "` in a splice buffer of size `" + (this.left.length + this.right.length) + "`");
		return e < this.left.length ? this.left[e] : this.right[this.right.length - e + this.left.length - 1];
	}
	get length() {
		return this.left.length + this.right.length;
	}
	shift() {
		return this.setCursor(0), this.right.pop();
	}
	slice(e, t) {
		let n = t ?? Infinity;
		return n < this.left.length ? this.left.slice(e, n) : e > this.left.length ? this.right.slice(this.right.length - n + this.left.length, this.right.length - e + this.left.length).reverse() : this.left.slice(e).concat(this.right.slice(this.right.length - n + this.left.length).reverse());
	}
	splice(e, t, n) {
		let r = t || 0;
		this.setCursor(Math.trunc(e));
		let i = this.right.splice(this.right.length - r, Infinity);
		return n && On(this.left, n), i.reverse();
	}
	pop() {
		return this.setCursor(Infinity), this.left.pop();
	}
	push(e) {
		this.setCursor(Infinity), this.left.push(e);
	}
	pushMany(e) {
		this.setCursor(Infinity), On(this.left, e);
	}
	unshift(e) {
		this.setCursor(0), this.right.push(e);
	}
	unshiftMany(e) {
		this.setCursor(0), On(this.right, e.reverse());
	}
	setCursor(e) {
		if (!(e === this.left.length || e > this.left.length && this.right.length === 0 || e < 0 && this.left.length === 0)) if (e < this.left.length) {
			let t = this.left.splice(e, Infinity);
			On(this.right, t.reverse());
		} else {
			let t = this.right.splice(this.left.length + this.right.length - e, Infinity);
			On(this.left, t.reverse());
		}
	}
};
function On(e, t) {
	let n = 0;
	if (t.length < 1e4) e.push(...t);
	else for (; n < t.length;) e.push(...t.slice(n, n + 1e4)), n += 1e4;
}
//#endregion
//#region node_modules/micromark-util-subtokenize/index.js
function kn(e) {
	let t = {}, n = -1, r, i, a, o, s, c, l, u = new Dn(e);
	for (; ++n < u.length;) {
		for (; n in t;) n = t[n];
		if (r = u.get(n), n && r[1].type === "chunkFlow" && u.get(n - 1)[1].type === "listItemPrefix" && (c = r[1]._tokenizer.events, a = 0, a < c.length && c[a][1].type === "lineEndingBlank" && (a += 2), a < c.length && c[a][1].type === "content")) for (; ++a < c.length && c[a][1].type !== "content";) c[a][1].type === "chunkText" && (c[a][1]._isInFirstContentOfListItem = !0, a++);
		if (r[0] === "enter") r[1].contentType && (Object.assign(t, An(u, n)), n = t[n], l = !0);
		else if (r[1]._container) {
			for (a = n, i = void 0; a--;) if (o = u.get(a), o[1].type === "lineEnding" || o[1].type === "lineEndingBlank") o[0] === "enter" && (i && (u.get(i)[1].type = "lineEndingBlank"), o[1].type = "lineEnding", i = a);
			else if (!(o[1].type === "linePrefix" || o[1].type === "listItemIndent")) break;
			i && (r[1].end = { ...u.get(i)[1].start }, s = u.slice(i, n), s.unshift(r), u.splice(i, n - i + 1, s));
		}
	}
	return Tt(e, 0, Infinity, u.slice(0)), !l;
}
function An(e, t) {
	let n = e.get(t)[1], r = e.get(t)[2], i = t - 1, a = [], o = n._tokenizer;
	o || (o = r.parser[n.contentType](n.start), n._contentTypeTextTrailing && (o._contentTypeTextTrailing = !0));
	let s = o.events, c = [], l = {}, u, d, f = -1, p = n, m = 0, h = 0, g = [h];
	for (; p;) {
		for (; e.get(++i)[1] !== p;);
		a.push(i), p._tokenizer || (u = r.sliceStream(p), p.next || u.push(null), d && o.defineSkip(p.start), p._isInFirstContentOfListItem && (o._gfmTasklistFirstContentOfListItem = !0), o.write(u), p._isInFirstContentOfListItem && (o._gfmTasklistFirstContentOfListItem = void 0)), d = p, p = p.next;
	}
	for (p = n; ++f < s.length;) s[f][0] === "exit" && s[f - 1][0] === "enter" && s[f][1].type === s[f - 1][1].type && s[f][1].start.line !== s[f][1].end.line && (h = f + 1, g.push(h), p._tokenizer = void 0, p.previous = void 0, p = p.next);
	for (o.events = [], p ? (p._tokenizer = void 0, p.previous = void 0) : g.pop(), f = g.length; f--;) {
		let t = s.slice(g[f], g[f + 1]), n = a.pop();
		c.push([n, n + t.length - 1]), e.splice(n, 2, t);
	}
	for (c.reverse(), f = -1; ++f < c.length;) l[m + c[f][0]] = m + c[f][1], m += c[f][1] - c[f][0] - 1;
	return l;
}
//#endregion
//#region node_modules/micromark-core-commonmark/lib/content.js
var jn = {
	resolve: Nn,
	tokenize: Pn
}, Mn = {
	partial: !0,
	tokenize: Fn
};
function Nn(e) {
	return kn(e), e;
}
function Pn(e, t) {
	let n;
	return r;
	function r(t) {
		return e.enter("content"), n = e.enter("chunkContent", { contentType: "content" }), i(t);
	}
	function i(t) {
		return t === null ? a(t) : P(t) ? e.check(Mn, o, a)(t) : (e.consume(t), i);
	}
	function a(n) {
		return e.exit("chunkContent"), e.exit("content"), t(n);
	}
	function o(t) {
		return e.consume(t), e.exit("chunkContent"), n.next = e.enter("chunkContent", {
			contentType: "content",
			previous: n
		}), n = n.next, i;
	}
}
function Fn(e, t, n) {
	let r = this;
	return i;
	function i(t) {
		return e.exit("chunkContent"), e.enter("lineEnding"), e.consume(t), e.exit("lineEnding"), L(e, a, "linePrefix");
	}
	function a(i) {
		if (i === null || P(i)) return n(i);
		let a = r.events[r.events.length - 1];
		return !r.parser.constructs.disable.null.includes("codeIndented") && a && a[1].type === "linePrefix" && a[2].sliceSerialize(a[1], !0).length >= 4 ? t(i) : e.interrupt(r.parser.constructs.flow, n, t)(i);
	}
}
//#endregion
//#region node_modules/micromark-factory-destination/index.js
function In(e, t, n, r, i, a, o, s, c) {
	let l = c || Infinity, u = 0;
	return d;
	function d(t) {
		return t === 60 ? (e.enter(r), e.enter(i), e.enter(a), e.consume(t), e.exit(a), f) : t === null || t === 32 || t === 41 || It(t) ? n(t) : (e.enter(r), e.enter(o), e.enter(s), e.enter("chunkString", { contentType: "string" }), h(t));
	}
	function f(n) {
		return n === 62 ? (e.enter(a), e.consume(n), e.exit(a), e.exit(i), e.exit(r), t) : (e.enter(s), e.enter("chunkString", { contentType: "string" }), p(n));
	}
	function p(t) {
		return t === 62 ? (e.exit("chunkString"), e.exit(s), f(t)) : t === null || t === 60 || P(t) ? n(t) : (e.consume(t), t === 92 ? m : p);
	}
	function m(t) {
		return t === 60 || t === 62 || t === 92 ? (e.consume(t), p) : p(t);
	}
	function h(i) {
		return !u && (i === null || i === 41 || F(i)) ? (e.exit("chunkString"), e.exit(s), e.exit(o), e.exit(r), t(i)) : u < l && i === 40 ? (e.consume(i), u++, h) : i === 41 ? (e.consume(i), u--, h) : i === null || i === 32 || i === 40 || It(i) ? n(i) : (e.consume(i), i === 92 ? g : h);
	}
	function g(t) {
		return t === 40 || t === 41 || t === 92 ? (e.consume(t), h) : h(t);
	}
}
//#endregion
//#region node_modules/micromark-factory-label/index.js
function Ln(e, t, n, r, i, a) {
	let o = this, s = 0, c;
	return l;
	function l(t) {
		return e.enter(r), e.enter(i), e.consume(t), e.exit(i), e.enter(a), u;
	}
	function u(l) {
		return s > 999 || l === null || l === 91 || l === 93 && !c || l === 94 && !s && "_hiddenFootnoteSupport" in o.parser.constructs ? n(l) : l === 93 ? (e.exit(a), e.enter(i), e.consume(l), e.exit(i), e.exit(r), t) : P(l) ? (e.enter("lineEnding"), e.consume(l), e.exit("lineEnding"), u) : (e.enter("chunkString", { contentType: "string" }), d(l));
	}
	function d(t) {
		return t === null || t === 91 || t === 93 || P(t) || s++ > 999 ? (e.exit("chunkString"), u(t)) : (e.consume(t), c ||= !I(t), t === 92 ? f : d);
	}
	function f(t) {
		return t === 91 || t === 92 || t === 93 ? (e.consume(t), s++, d) : d(t);
	}
}
//#endregion
//#region node_modules/micromark-factory-title/index.js
function Rn(e, t, n, r, i, a) {
	let o;
	return s;
	function s(t) {
		return t === 34 || t === 39 || t === 40 ? (e.enter(r), e.enter(i), e.consume(t), e.exit(i), o = t === 40 ? 41 : t, c) : n(t);
	}
	function c(n) {
		return n === o ? (e.enter(i), e.consume(n), e.exit(i), e.exit(r), t) : (e.enter(a), l(n));
	}
	function l(t) {
		return t === o ? (e.exit(a), c(o)) : t === null ? n(t) : P(t) ? (e.enter("lineEnding"), e.consume(t), e.exit("lineEnding"), L(e, l, "linePrefix")) : (e.enter("chunkString", { contentType: "string" }), u(t));
	}
	function u(t) {
		return t === o || t === null || P(t) ? (e.exit("chunkString"), l(t)) : (e.consume(t), t === 92 ? d : u);
	}
	function d(t) {
		return t === o || t === 92 ? (e.consume(t), u) : u(t);
	}
}
//#endregion
//#region node_modules/micromark-factory-whitespace/index.js
function zn(e, t) {
	let n;
	return r;
	function r(i) {
		return P(i) ? (e.enter("lineEnding"), e.consume(i), e.exit("lineEnding"), n = !0, r) : I(i) ? L(e, r, n ? "linePrefix" : "lineSuffix")(i) : t(i);
	}
}
//#endregion
//#region node_modules/micromark-core-commonmark/lib/definition.js
var Bn = {
	name: "definition",
	tokenize: Hn
}, Vn = {
	partial: !0,
	tokenize: Un
};
function Hn(e, t, n) {
	let r = this, i;
	return a;
	function a(t) {
		return e.enter("definition"), o(t);
	}
	function o(t) {
		return Ln.call(r, e, s, n, "definitionLabel", "definitionLabelMarker", "definitionLabelString")(t);
	}
	function s(t) {
		return i = Mt(r.sliceSerialize(r.events[r.events.length - 1][1]).slice(1, -1)), t === 58 ? (e.enter("definitionMarker"), e.consume(t), e.exit("definitionMarker"), c) : n(t);
	}
	function c(t) {
		return F(t) ? zn(e, l)(t) : l(t);
	}
	function l(t) {
		return In(e, u, n, "definitionDestination", "definitionDestinationLiteral", "definitionDestinationLiteralMarker", "definitionDestinationRaw", "definitionDestinationString")(t);
	}
	function u(t) {
		return e.attempt(Vn, d, d)(t);
	}
	function d(t) {
		return I(t) ? L(e, f, "whitespace")(t) : f(t);
	}
	function f(a) {
		return a === null || P(a) ? (e.exit("definition"), r.parser.defined.push(i), t(a)) : n(a);
	}
}
function Un(e, t, n) {
	return r;
	function r(t) {
		return F(t) ? zn(e, i)(t) : n(t);
	}
	function i(t) {
		return Rn(e, a, n, "definitionTitle", "definitionTitleMarker", "definitionTitleString")(t);
	}
	function a(t) {
		return I(t) ? L(e, o, "whitespace")(t) : o(t);
	}
	function o(e) {
		return e === null || P(e) ? t(e) : n(e);
	}
}
//#endregion
//#region node_modules/micromark-core-commonmark/lib/hard-break-escape.js
var Wn = {
	name: "hardBreakEscape",
	tokenize: Gn
};
function Gn(e, t, n) {
	return r;
	function r(t) {
		return e.enter("hardBreakEscape"), e.consume(t), i;
	}
	function i(r) {
		return P(r) ? (e.exit("hardBreakEscape"), t(r)) : n(r);
	}
}
//#endregion
//#region node_modules/micromark-core-commonmark/lib/heading-atx.js
var Kn = {
	name: "headingAtx",
	resolve: qn,
	tokenize: Jn
};
function qn(e, t) {
	let n = e.length - 2, r = 3, i, a;
	return e[r][1].type === "whitespace" && (r += 2), n - 2 > r && e[n][1].type === "whitespace" && (n -= 2), e[n][1].type === "atxHeadingSequence" && (r === n - 1 || n - 4 > r && e[n - 2][1].type === "whitespace") && (n -= r + 1 === n ? 2 : 4), n > r && (i = {
		type: "atxHeadingText",
		start: e[r][1].start,
		end: e[n][1].end
	}, a = {
		type: "chunkText",
		start: e[r][1].start,
		end: e[n][1].end,
		contentType: "text"
	}, Tt(e, r, n - r + 1, [
		[
			"enter",
			i,
			t
		],
		[
			"enter",
			a,
			t
		],
		[
			"exit",
			a,
			t
		],
		[
			"exit",
			i,
			t
		]
	])), e;
}
function Jn(e, t, n) {
	let r = 0;
	return i;
	function i(t) {
		return e.enter("atxHeading"), a(t);
	}
	function a(t) {
		return e.enter("atxHeadingSequence"), o(t);
	}
	function o(t) {
		return t === 35 && r++ < 6 ? (e.consume(t), o) : t === null || F(t) ? (e.exit("atxHeadingSequence"), s(t)) : n(t);
	}
	function s(n) {
		return n === 35 ? (e.enter("atxHeadingSequence"), c(n)) : n === null || P(n) ? (e.exit("atxHeading"), t(n)) : I(n) ? L(e, s, "whitespace")(n) : (e.enter("atxHeadingText"), l(n));
	}
	function c(t) {
		return t === 35 ? (e.consume(t), c) : (e.exit("atxHeadingSequence"), s(t));
	}
	function l(t) {
		return t === null || t === 35 || F(t) ? (e.exit("atxHeadingText"), s(t)) : (e.consume(t), l);
	}
}
//#endregion
//#region node_modules/micromark-util-html-tag-name/index.js
var Yn = /* @__PURE__ */ "address.article.aside.base.basefont.blockquote.body.caption.center.col.colgroup.dd.details.dialog.dir.div.dl.dt.fieldset.figcaption.figure.footer.form.frame.frameset.h1.h2.h3.h4.h5.h6.head.header.hr.html.iframe.legend.li.link.main.menu.menuitem.nav.noframes.ol.optgroup.option.p.param.search.section.summary.table.tbody.td.tfoot.th.thead.title.tr.track.ul".split("."), Xn = [
	"pre",
	"script",
	"style",
	"textarea"
], Zn = {
	concrete: !0,
	name: "htmlFlow",
	resolveTo: er,
	tokenize: tr
}, Qn = {
	partial: !0,
	tokenize: rr
}, $n = {
	partial: !0,
	tokenize: nr
};
function er(e) {
	let t = e.length;
	for (; t-- && !(e[t][0] === "enter" && e[t][1].type === "htmlFlow"););
	return t > 1 && e[t - 2][1].type === "linePrefix" && (e[t][1].start = e[t - 2][1].start, e[t + 1][1].start = e[t - 2][1].start, e.splice(t - 2, 2)), e;
}
function tr(e, t, n) {
	let r = this, i, a, o, s, c;
	return l;
	function l(e) {
		return u(e);
	}
	function u(t) {
		return e.enter("htmlFlow"), e.enter("htmlFlowData"), e.consume(t), d;
	}
	function d(s) {
		return s === 33 ? (e.consume(s), f) : s === 47 ? (e.consume(s), a = !0, h) : s === 63 ? (e.consume(s), i = 3, r.interrupt ? t : A) : Nt(s) ? (e.consume(s), o = String.fromCharCode(s), g) : n(s);
	}
	function f(a) {
		return a === 45 ? (e.consume(a), i = 2, p) : a === 91 ? (e.consume(a), i = 5, s = 0, m) : Nt(a) ? (e.consume(a), i = 4, r.interrupt ? t : A) : n(a);
	}
	function p(i) {
		return i === 45 ? (e.consume(i), r.interrupt ? t : A) : n(i);
	}
	function m(i) {
		return i === "CDATA[".charCodeAt(s++) ? (e.consume(i), s === 6 ? r.interrupt ? t : T : m) : n(i);
	}
	function h(t) {
		return Nt(t) ? (e.consume(t), o = String.fromCharCode(t), g) : n(t);
	}
	function g(s) {
		if (s === null || s === 47 || s === 62 || F(s)) {
			let c = s === 47, l = o.toLowerCase();
			return !c && !a && Xn.includes(l) ? (i = 1, r.interrupt ? t(s) : T(s)) : Yn.includes(o.toLowerCase()) ? (i = 6, c ? (e.consume(s), _) : r.interrupt ? t(s) : T(s)) : (i = 7, r.interrupt && !r.parser.lazy[r.now().line] ? n(s) : a ? v(s) : y(s));
		}
		return s === 45 || Pt(s) ? (e.consume(s), o += String.fromCharCode(s), g) : n(s);
	}
	function _(i) {
		return i === 62 ? (e.consume(i), r.interrupt ? t : T) : n(i);
	}
	function v(t) {
		return I(t) ? (e.consume(t), v) : w(t);
	}
	function y(t) {
		return t === 47 ? (e.consume(t), w) : t === 58 || t === 95 || Nt(t) ? (e.consume(t), b) : I(t) ? (e.consume(t), y) : w(t);
	}
	function b(t) {
		return t === 45 || t === 46 || t === 58 || t === 95 || Pt(t) ? (e.consume(t), b) : ee(t);
	}
	function ee(t) {
		return t === 61 ? (e.consume(t), x) : I(t) ? (e.consume(t), ee) : y(t);
	}
	function x(t) {
		return t === null || t === 60 || t === 61 || t === 62 || t === 96 ? n(t) : t === 34 || t === 39 ? (e.consume(t), c = t, S) : I(t) ? (e.consume(t), x) : te(t);
	}
	function S(t) {
		return t === c ? (e.consume(t), c = null, C) : t === null || P(t) ? n(t) : (e.consume(t), S);
	}
	function te(t) {
		return t === null || t === 34 || t === 39 || t === 47 || t === 60 || t === 61 || t === 62 || t === 96 || F(t) ? ee(t) : (e.consume(t), te);
	}
	function C(e) {
		return e === 47 || e === 62 || I(e) ? y(e) : n(e);
	}
	function w(t) {
		return t === 62 ? (e.consume(t), ne) : n(t);
	}
	function ne(t) {
		return t === null || P(t) ? T(t) : I(t) ? (e.consume(t), ne) : n(t);
	}
	function T(t) {
		return t === 45 && i === 2 ? (e.consume(t), D) : t === 60 && i === 1 ? (e.consume(t), O) : t === 62 && i === 4 ? (e.consume(t), j) : t === 63 && i === 3 ? (e.consume(t), A) : t === 93 && i === 5 ? (e.consume(t), k) : P(t) && (i === 6 || i === 7) ? (e.exit("htmlFlowData"), e.check(Qn, M, E)(t)) : t === null || P(t) ? (e.exit("htmlFlowData"), E(t)) : (e.consume(t), T);
	}
	function E(t) {
		return e.check($n, re, M)(t);
	}
	function re(t) {
		return e.enter("lineEnding"), e.consume(t), e.exit("lineEnding"), ie;
	}
	function ie(t) {
		return t === null || P(t) ? E(t) : (e.enter("htmlFlowData"), T(t));
	}
	function D(t) {
		return t === 45 ? (e.consume(t), A) : T(t);
	}
	function O(t) {
		return t === 47 ? (e.consume(t), o = "", ae) : T(t);
	}
	function ae(t) {
		if (t === 62) {
			let n = o.toLowerCase();
			return Xn.includes(n) ? (e.consume(t), j) : T(t);
		}
		return Nt(t) && o.length < 8 ? (e.consume(t), o += String.fromCharCode(t), ae) : T(t);
	}
	function k(t) {
		return t === 93 ? (e.consume(t), A) : T(t);
	}
	function A(t) {
		return t === 62 ? (e.consume(t), j) : t === 45 && i === 2 ? (e.consume(t), A) : T(t);
	}
	function j(t) {
		return t === null || P(t) ? (e.exit("htmlFlowData"), M(t)) : (e.consume(t), j);
	}
	function M(n) {
		return e.exit("htmlFlow"), t(n);
	}
}
function nr(e, t, n) {
	let r = this;
	return i;
	function i(t) {
		return P(t) ? (e.enter("lineEnding"), e.consume(t), e.exit("lineEnding"), a) : n(t);
	}
	function a(e) {
		return r.parser.lazy[r.now().line] ? n(e) : t(e);
	}
}
function rr(e, t, n) {
	return r;
	function r(r) {
		return e.enter("lineEnding"), e.consume(r), e.exit("lineEnding"), e.attempt(an, t, n);
	}
}
//#endregion
//#region node_modules/micromark-core-commonmark/lib/html-text.js
var ir = {
	name: "htmlText",
	tokenize: ar
};
function ar(e, t, n) {
	let r = this, i, a, o;
	return s;
	function s(t) {
		return e.enter("htmlText"), e.enter("htmlTextData"), e.consume(t), c;
	}
	function c(t) {
		return t === 33 ? (e.consume(t), l) : t === 47 ? (e.consume(t), ee) : t === 63 ? (e.consume(t), y) : Nt(t) ? (e.consume(t), te) : n(t);
	}
	function l(t) {
		return t === 45 ? (e.consume(t), u) : t === 91 ? (e.consume(t), a = 0, m) : Nt(t) ? (e.consume(t), v) : n(t);
	}
	function u(t) {
		return t === 45 ? (e.consume(t), p) : n(t);
	}
	function d(t) {
		return t === null ? n(t) : t === 45 ? (e.consume(t), f) : P(t) ? (o = d, O(t)) : (e.consume(t), d);
	}
	function f(t) {
		return t === 45 ? (e.consume(t), p) : d(t);
	}
	function p(e) {
		return e === 62 ? D(e) : e === 45 ? f(e) : d(e);
	}
	function m(t) {
		return t === "CDATA[".charCodeAt(a++) ? (e.consume(t), a === 6 ? h : m) : n(t);
	}
	function h(t) {
		return t === null ? n(t) : t === 93 ? (e.consume(t), g) : P(t) ? (o = h, O(t)) : (e.consume(t), h);
	}
	function g(t) {
		return t === 93 ? (e.consume(t), _) : h(t);
	}
	function _(t) {
		return t === 62 ? D(t) : t === 93 ? (e.consume(t), _) : h(t);
	}
	function v(t) {
		return t === null || t === 62 ? D(t) : P(t) ? (o = v, O(t)) : (e.consume(t), v);
	}
	function y(t) {
		return t === null ? n(t) : t === 63 ? (e.consume(t), b) : P(t) ? (o = y, O(t)) : (e.consume(t), y);
	}
	function b(e) {
		return e === 62 ? D(e) : y(e);
	}
	function ee(t) {
		return Nt(t) ? (e.consume(t), x) : n(t);
	}
	function x(t) {
		return t === 45 || Pt(t) ? (e.consume(t), x) : S(t);
	}
	function S(t) {
		return P(t) ? (o = S, O(t)) : I(t) ? (e.consume(t), S) : D(t);
	}
	function te(t) {
		return t === 45 || Pt(t) ? (e.consume(t), te) : t === 47 || t === 62 || F(t) ? C(t) : n(t);
	}
	function C(t) {
		return t === 47 ? (e.consume(t), D) : t === 58 || t === 95 || Nt(t) ? (e.consume(t), w) : P(t) ? (o = C, O(t)) : I(t) ? (e.consume(t), C) : D(t);
	}
	function w(t) {
		return t === 45 || t === 46 || t === 58 || t === 95 || Pt(t) ? (e.consume(t), w) : ne(t);
	}
	function ne(t) {
		return t === 61 ? (e.consume(t), T) : P(t) ? (o = ne, O(t)) : I(t) ? (e.consume(t), ne) : C(t);
	}
	function T(t) {
		return t === null || t === 60 || t === 61 || t === 62 || t === 96 ? n(t) : t === 34 || t === 39 ? (e.consume(t), i = t, E) : P(t) ? (o = T, O(t)) : I(t) ? (e.consume(t), T) : (e.consume(t), re);
	}
	function E(t) {
		return t === i ? (e.consume(t), i = void 0, ie) : t === null ? n(t) : P(t) ? (o = E, O(t)) : (e.consume(t), E);
	}
	function re(t) {
		return t === null || t === 34 || t === 39 || t === 60 || t === 61 || t === 96 ? n(t) : t === 47 || t === 62 || F(t) ? C(t) : (e.consume(t), re);
	}
	function ie(e) {
		return e === 47 || e === 62 || F(e) ? C(e) : n(e);
	}
	function D(r) {
		return r === 62 ? (e.consume(r), e.exit("htmlTextData"), e.exit("htmlText"), t) : n(r);
	}
	function O(t) {
		return e.exit("htmlTextData"), e.enter("lineEnding"), e.consume(t), e.exit("lineEnding"), ae;
	}
	function ae(t) {
		return I(t) ? L(e, k, "linePrefix", r.parser.constructs.disable.null.includes("codeIndented") ? void 0 : 4)(t) : k(t);
	}
	function k(t) {
		return e.enter("htmlTextData"), o(t);
	}
}
//#endregion
//#region node_modules/micromark-core-commonmark/lib/label-end.js
var or = {
	name: "labelEnd",
	resolveAll: ur,
	resolveTo: dr,
	tokenize: fr
}, sr = { tokenize: pr }, cr = { tokenize: mr }, lr = { tokenize: hr };
function ur(e) {
	let t = -1, n = [];
	for (; ++t < e.length;) {
		let r = e[t][1];
		if (n.push(e[t]), r.type === "labelImage" || r.type === "labelLink" || r.type === "labelEnd") {
			let e = r.type === "labelImage" ? 4 : 2;
			r.type = "data", t += e;
		}
	}
	return e.length !== n.length && Tt(e, 0, e.length, n), e;
}
function dr(e, t) {
	let n = e.length, r = 0, i, a, o, s;
	for (; n--;) if (i = e[n][1], a) {
		if (i.type === "link" || i.type === "labelLink" && i._inactive) break;
		e[n][0] === "enter" && i.type === "labelLink" && (i._inactive = !0);
	} else if (o) {
		if (e[n][0] === "enter" && (i.type === "labelImage" || i.type === "labelLink") && !i._balanced && (a = n, i.type !== "labelLink")) {
			r = 2;
			break;
		}
	} else i.type === "labelEnd" && (o = n);
	let c = {
		type: e[a][1].type === "labelLink" ? "link" : "image",
		start: { ...e[a][1].start },
		end: { ...e[e.length - 1][1].end }
	}, l = {
		type: "label",
		start: { ...e[a][1].start },
		end: { ...e[o][1].end }
	}, u = {
		type: "labelText",
		start: { ...e[a + r + 2][1].end },
		end: { ...e[o - 2][1].start }
	};
	return s = [[
		"enter",
		c,
		t
	], [
		"enter",
		l,
		t
	]], s = Et(s, e.slice(a + 1, a + r + 3)), s = Et(s, [[
		"enter",
		u,
		t
	]]), s = Et(s, Zt(t.parser.constructs.insideSpan.null, e.slice(a + r + 4, o - 3), t)), s = Et(s, [
		[
			"exit",
			u,
			t
		],
		e[o - 2],
		e[o - 1],
		[
			"exit",
			l,
			t
		]
	]), s = Et(s, e.slice(o + 1)), s = Et(s, [[
		"exit",
		c,
		t
	]]), Tt(e, a, e.length, s), e;
}
function fr(e, t, n) {
	let r = this, i = r.events.length, a, o;
	for (; i--;) if ((r.events[i][1].type === "labelImage" || r.events[i][1].type === "labelLink") && !r.events[i][1]._balanced) {
		a = r.events[i][1];
		break;
	}
	return s;
	function s(t) {
		return a ? a._inactive ? d(t) : (o = r.parser.defined.includes(Mt(r.sliceSerialize({
			start: a.end,
			end: r.now()
		}))), e.enter("labelEnd"), e.enter("labelMarker"), e.consume(t), e.exit("labelMarker"), e.exit("labelEnd"), c) : n(t);
	}
	function c(t) {
		return t === 40 ? e.attempt(sr, u, o ? u : d)(t) : t === 91 ? e.attempt(cr, u, o ? l : d)(t) : o ? u(t) : d(t);
	}
	function l(t) {
		return e.attempt(lr, u, d)(t);
	}
	function u(e) {
		return t(e);
	}
	function d(e) {
		return a._balanced = !0, n(e);
	}
}
function pr(e, t, n) {
	return r;
	function r(t) {
		return e.enter("resource"), e.enter("resourceMarker"), e.consume(t), e.exit("resourceMarker"), i;
	}
	function i(t) {
		return F(t) ? zn(e, a)(t) : a(t);
	}
	function a(t) {
		return t === 41 ? u(t) : In(e, o, s, "resourceDestination", "resourceDestinationLiteral", "resourceDestinationLiteralMarker", "resourceDestinationRaw", "resourceDestinationString", 32)(t);
	}
	function o(t) {
		return F(t) ? zn(e, c)(t) : u(t);
	}
	function s(e) {
		return n(e);
	}
	function c(t) {
		return t === 34 || t === 39 || t === 40 ? Rn(e, l, n, "resourceTitle", "resourceTitleMarker", "resourceTitleString")(t) : u(t);
	}
	function l(t) {
		return F(t) ? zn(e, u)(t) : u(t);
	}
	function u(r) {
		return r === 41 ? (e.enter("resourceMarker"), e.consume(r), e.exit("resourceMarker"), e.exit("resource"), t) : n(r);
	}
}
function mr(e, t, n) {
	let r = this;
	return i;
	function i(t) {
		return Ln.call(r, e, a, o, "reference", "referenceMarker", "referenceString")(t);
	}
	function a(e) {
		return r.parser.defined.includes(Mt(r.sliceSerialize(r.events[r.events.length - 1][1]).slice(1, -1))) ? t(e) : n(e);
	}
	function o(e) {
		return n(e);
	}
}
function hr(e, t, n) {
	return r;
	function r(t) {
		return e.enter("reference"), e.enter("referenceMarker"), e.consume(t), e.exit("referenceMarker"), i;
	}
	function i(r) {
		return r === 93 ? (e.enter("referenceMarker"), e.consume(r), e.exit("referenceMarker"), e.exit("reference"), t) : n(r);
	}
}
//#endregion
//#region node_modules/micromark-core-commonmark/lib/label-start-image.js
var gr = {
	name: "labelStartImage",
	resolveAll: or.resolveAll,
	tokenize: _r
};
function _r(e, t, n) {
	let r = this;
	return i;
	function i(t) {
		return e.enter("labelImage"), e.enter("labelImageMarker"), e.consume(t), e.exit("labelImageMarker"), a;
	}
	function a(t) {
		return t === 91 ? (e.enter("labelMarker"), e.consume(t), e.exit("labelMarker"), e.exit("labelImage"), o) : n(t);
	}
	function o(e) {
		/* c8 ignore next 3 */
		return e === 94 && "_hiddenFootnoteSupport" in r.parser.constructs ? n(e) : t(e);
	}
}
//#endregion
//#region node_modules/micromark-core-commonmark/lib/label-start-link.js
var vr = {
	name: "labelStartLink",
	resolveAll: or.resolveAll,
	tokenize: yr
};
function yr(e, t, n) {
	let r = this;
	return i;
	function i(t) {
		return e.enter("labelLink"), e.enter("labelMarker"), e.consume(t), e.exit("labelMarker"), e.exit("labelLink"), a;
	}
	function a(e) {
		/* c8 ignore next 3 */
		return e === 94 && "_hiddenFootnoteSupport" in r.parser.constructs ? n(e) : t(e);
	}
}
//#endregion
//#region node_modules/micromark-core-commonmark/lib/line-ending.js
var br = {
	name: "lineEnding",
	tokenize: xr
};
function xr(e, t) {
	return n;
	function n(n) {
		return e.enter("lineEnding"), e.consume(n), e.exit("lineEnding"), L(e, t, "linePrefix");
	}
}
//#endregion
//#region node_modules/micromark-core-commonmark/lib/thematic-break.js
var Sr = {
	name: "thematicBreak",
	tokenize: Cr
};
function Cr(e, t, n) {
	let r = 0, i;
	return a;
	function a(t) {
		return e.enter("thematicBreak"), o(t);
	}
	function o(e) {
		return i = e, s(e);
	}
	function s(a) {
		return a === i ? (e.enter("thematicBreakSequence"), c(a)) : r >= 3 && (a === null || P(a)) ? (e.exit("thematicBreak"), t(a)) : n(a);
	}
	function c(t) {
		return t === i ? (e.consume(t), r++, c) : (e.exit("thematicBreakSequence"), I(t) ? L(e, s, "whitespace")(t) : s(t));
	}
}
//#endregion
//#region node_modules/micromark-core-commonmark/lib/list.js
var wr = {
	continuation: { tokenize: Or },
	exit: Ar,
	name: "list",
	tokenize: Dr
}, Tr = {
	partial: !0,
	tokenize: jr
}, Er = {
	partial: !0,
	tokenize: kr
};
function Dr(e, t, n) {
	let r = this, i = r.events[r.events.length - 1], a = i && i[1].type === "linePrefix" ? i[2].sliceSerialize(i[1], !0).length : 0, o = 0;
	return s;
	function s(t) {
		let i = r.containerState.type || (t === 42 || t === 43 || t === 45 ? "listUnordered" : "listOrdered");
		if (i === "listUnordered" ? !r.containerState.marker || t === r.containerState.marker : Lt(t)) {
			if (r.containerState.type || (r.containerState.type = i, e.enter(i, { _container: !0 })), i === "listUnordered") return e.enter("listItemPrefix"), t === 42 || t === 45 ? e.check(Sr, n, l)(t) : l(t);
			if (!r.interrupt || t === 49) return e.enter("listItemPrefix"), e.enter("listItemValue"), c(t);
		}
		return n(t);
	}
	function c(t) {
		return Lt(t) && ++o < 10 ? (e.consume(t), c) : (!r.interrupt || o < 2) && (r.containerState.marker ? t === r.containerState.marker : t === 41 || t === 46) ? (e.exit("listItemValue"), l(t)) : n(t);
	}
	function l(t) {
		return e.enter("listItemMarker"), e.consume(t), e.exit("listItemMarker"), r.containerState.marker = r.containerState.marker || t, e.check(an, r.interrupt ? n : u, e.attempt(Tr, f, d));
	}
	function u(e) {
		return r.containerState.initialBlankLine = !0, a++, f(e);
	}
	function d(t) {
		return I(t) ? (e.enter("listItemPrefixWhitespace"), e.consume(t), e.exit("listItemPrefixWhitespace"), f) : n(t);
	}
	function f(n) {
		return r.containerState.size = a + r.sliceSerialize(e.exit("listItemPrefix"), !0).length, t(n);
	}
}
function Or(e, t, n) {
	let r = this;
	return r.containerState._closeFlow = void 0, e.check(an, i, a);
	function i(n) {
		return r.containerState.furtherBlankLines = r.containerState.furtherBlankLines || r.containerState.initialBlankLine, L(e, t, "listItemIndent", r.containerState.size + 1)(n);
	}
	function a(n) {
		return r.containerState.furtherBlankLines || !I(n) ? (r.containerState.furtherBlankLines = void 0, r.containerState.initialBlankLine = void 0, o(n)) : (r.containerState.furtherBlankLines = void 0, r.containerState.initialBlankLine = void 0, e.attempt(Er, t, o)(n));
	}
	function o(i) {
		return r.containerState._closeFlow = !0, r.interrupt = void 0, L(e, e.attempt(wr, t, n), "linePrefix", r.parser.constructs.disable.null.includes("codeIndented") ? void 0 : 4)(i);
	}
}
function kr(e, t, n) {
	let r = this;
	return L(e, i, "listItemIndent", r.containerState.size + 1);
	function i(e) {
		let i = r.events[r.events.length - 1];
		return i && i[1].type === "listItemIndent" && i[2].sliceSerialize(i[1], !0).length === r.containerState.size ? t(e) : n(e);
	}
}
function Ar(e) {
	e.exit(this.containerState.type);
}
function jr(e, t, n) {
	let r = this;
	return L(e, i, "listItemPrefixWhitespace", r.parser.constructs.disable.null.includes("codeIndented") ? void 0 : 5);
	function i(e) {
		let i = r.events[r.events.length - 1];
		return !I(e) && i && i[1].type === "listItemPrefixWhitespace" ? t(e) : n(e);
	}
}
//#endregion
//#region node_modules/micromark-core-commonmark/lib/setext-underline.js
var Mr = {
	name: "setextUnderline",
	resolveTo: Nr,
	tokenize: Pr
};
function Nr(e, t) {
	let n = e.length, r, i, a;
	for (; n--;) if (e[n][0] === "enter") {
		if (e[n][1].type === "content") {
			r = n;
			break;
		}
		e[n][1].type === "paragraph" && (i = n);
	} else e[n][1].type === "content" && e.splice(n, 1), !a && e[n][1].type === "definition" && (a = n);
	let o = {
		type: "setextHeading",
		start: { ...e[r][1].start },
		end: { ...e[e.length - 1][1].end }
	};
	return e[i][1].type = "setextHeadingText", a ? (e.splice(i, 0, [
		"enter",
		o,
		t
	]), e.splice(a + 1, 0, [
		"exit",
		e[r][1],
		t
	]), e[r][1].end = { ...e[a][1].end }) : e[r][1] = o, e.push([
		"exit",
		o,
		t
	]), e;
}
function Pr(e, t, n) {
	let r = this, i;
	return a;
	function a(t) {
		let a = r.events.length, s;
		for (; a--;) if (r.events[a][1].type !== "lineEnding" && r.events[a][1].type !== "linePrefix" && r.events[a][1].type !== "content") {
			s = r.events[a][1].type === "paragraph";
			break;
		}
		return !r.parser.lazy[r.now().line] && (r.interrupt || s) ? (e.enter("setextHeadingLine"), i = t, o(t)) : n(t);
	}
	function o(t) {
		return e.enter("setextHeadingLineSequence"), s(t);
	}
	function s(t) {
		return t === i ? (e.consume(t), s) : (e.exit("setextHeadingLineSequence"), I(t) ? L(e, c, "lineSuffix")(t) : c(t));
	}
	function c(r) {
		return r === null || P(r) ? (e.exit("setextHeadingLine"), t(r)) : n(r);
	}
}
//#endregion
//#region node_modules/micromark/lib/initialize/flow.js
var Fr = { tokenize: Ir };
function Ir(e) {
	let t = this, n = e.attempt(an, r, e.attempt(this.parser.constructs.flowInitial, i, L(e, e.attempt(this.parser.constructs.flow, i, e.attempt(jn, i)), "linePrefix")));
	return n;
	function r(r) {
		if (r === null) {
			e.consume(r);
			return;
		}
		return e.enter("lineEndingBlank"), e.consume(r), e.exit("lineEndingBlank"), t.currentConstruct = void 0, n;
	}
	function i(r) {
		if (r === null) {
			e.consume(r);
			return;
		}
		return e.enter("lineEnding"), e.consume(r), e.exit("lineEnding"), t.currentConstruct = void 0, n;
	}
}
//#endregion
//#region node_modules/micromark/lib/initialize/text.js
var Lr = { resolveAll: Vr() }, Rr = Br("string"), zr = Br("text");
function Br(e) {
	return {
		resolveAll: Vr(e === "text" ? Hr : void 0),
		tokenize: t
	};
	function t(t) {
		let n = this, r = this.parser.constructs[e], i = t.attempt(r, a, o);
		return a;
		function a(e) {
			return c(e) ? i(e) : o(e);
		}
		function o(e) {
			if (e === null) {
				t.consume(e);
				return;
			}
			return t.enter("data"), t.consume(e), s;
		}
		function s(e) {
			return c(e) ? (t.exit("data"), i(e)) : (t.consume(e), s);
		}
		function c(e) {
			if (e === null) return !0;
			let t = r[e], i = -1;
			if (t) for (; ++i < t.length;) {
				let e = t[i];
				if (!e.previous || e.previous.call(n, n.previous)) return !0;
			}
			return !1;
		}
	}
}
function Vr(e) {
	return t;
	function t(t, n) {
		let r = -1, i;
		for (; ++r <= t.length;) i === void 0 ? t[r] && t[r][1].type === "data" && (i = r, r++) : (!t[r] || t[r][1].type !== "data") && (r !== i + 2 && (t[i][1].end = t[r - 1][1].end, t.splice(i + 2, r - i - 2), r = i + 2), i = void 0);
		return e ? e(t, n) : t;
	}
}
function Hr(e, t) {
	let n = 0;
	for (; ++n <= e.length;) if ((n === e.length || e[n][1].type === "lineEnding") && e[n - 1][1].type === "data") {
		let r = e[n - 1][1], i = t.sliceStream(r), a = i.length, o = -1, s = 0, c;
		for (; a--;) {
			let e = i[a];
			if (typeof e == "string") {
				for (o = e.length; e.charCodeAt(o - 1) === 32;) s++, o--;
				if (o) break;
				o = -1;
			} else if (e === -2) c = !0, s++;
			else if (e !== -1) {
				a++;
				break;
			}
		}
		if (t._contentTypeTextTrailing && n === e.length && (s = 0), s) {
			let i = {
				type: n === e.length || c || s < 2 ? "lineSuffix" : "hardBreakTrailing",
				start: {
					_bufferIndex: a ? o : r.start._bufferIndex + o,
					_index: r.start._index + a,
					line: r.end.line,
					column: r.end.column - s,
					offset: r.end.offset - s
				},
				end: { ...r.end }
			};
			r.end = { ...i.start }, r.start.offset === r.end.offset ? Object.assign(r, i) : (e.splice(n, 0, [
				"enter",
				i,
				t
			], [
				"exit",
				i,
				t
			]), n += 2);
		}
		n++;
	}
	return e;
}
//#endregion
//#region node_modules/micromark/lib/constructs.js
var Ur = /* @__PURE__ */ s({
	attentionMarkers: () => Zr,
	contentInitial: () => Gr,
	disable: () => Qr,
	document: () => Wr,
	flow: () => qr,
	flowInitial: () => Kr,
	insideSpan: () => Xr,
	string: () => Jr,
	text: () => Yr
}), Wr = {
	42: wr,
	43: wr,
	45: wr,
	48: wr,
	49: wr,
	50: wr,
	51: wr,
	52: wr,
	53: wr,
	54: wr,
	55: wr,
	56: wr,
	57: wr,
	62: sn
}, Gr = { 91: Bn }, Kr = {
	[-2]: yn,
	[-1]: yn,
	32: yn
}, qr = {
	35: Kn,
	42: Sr,
	45: [Mr, Sr],
	60: Zn,
	61: Mr,
	95: Sr,
	96: gn,
	126: gn
}, Jr = {
	38: pn,
	92: dn
}, Yr = {
	[-5]: br,
	[-4]: br,
	[-3]: br,
	33: gr,
	38: pn,
	42: Qt,
	60: [nn, ir],
	91: vr,
	92: [Wn, dn],
	93: or,
	95: Qt,
	96: Cn
}, Xr = { null: [Qt, Lr] }, Zr = { null: [42, 95] }, Qr = { null: [] };
//#endregion
//#region node_modules/micromark/lib/create-tokenizer.js
function $r(e, t, n) {
	let r = {
		_bufferIndex: -1,
		_index: 0,
		line: n && n.line || 1,
		column: n && n.column || 1,
		offset: n && n.offset || 0
	}, i = {}, a = [], o = [], s = [], c = {
		attempt: S(ee),
		check: S(x),
		consume: v,
		enter: y,
		exit: b,
		interrupt: S(x, { interrupt: !0 })
	}, l = {
		code: null,
		containerState: {},
		defineSkip: h,
		events: [],
		now: m,
		parser: e,
		previous: null,
		sliceSerialize: f,
		sliceStream: p,
		write: d
	}, u = t.tokenize.call(l, c);
	return t.resolveAll && a.push(t), l;
	function d(e) {
		return o = Et(o, e), g(), o[o.length - 1] === null ? (te(t, 0), l.events = Zt(a, l.events, l), l.events) : [];
	}
	function f(e, t) {
		return ti(p(e), t);
	}
	function p(e) {
		return ei(o, e);
	}
	function m() {
		let { _bufferIndex: e, _index: t, line: n, column: i, offset: a } = r;
		return {
			_bufferIndex: e,
			_index: t,
			line: n,
			column: i,
			offset: a
		};
	}
	function h(e) {
		i[e.line] = e.column, w();
	}
	function g() {
		let e;
		for (; r._index < o.length;) {
			let t = o[r._index];
			if (typeof t == "string") for (e = r._index, r._bufferIndex < 0 && (r._bufferIndex = 0); r._index === e && r._bufferIndex < t.length;) _(t.charCodeAt(r._bufferIndex));
			else _(t);
		}
	}
	function _(e) {
		u = u(e);
	}
	function v(e) {
		P(e) ? (r.line++, r.column = 1, r.offset += e === -3 ? 2 : 1, w()) : e !== -1 && (r.column++, r.offset++), r._bufferIndex < 0 ? r._index++ : (r._bufferIndex++, r._bufferIndex === o[r._index].length && (r._bufferIndex = -1, r._index++)), l.previous = e;
	}
	function y(e, t) {
		let n = t || {};
		return n.type = e, n.start = m(), l.events.push([
			"enter",
			n,
			l
		]), s.push(n), n;
	}
	function b(e) {
		let t = s.pop();
		return t.end = m(), l.events.push([
			"exit",
			t,
			l
		]), t;
	}
	function ee(e, t) {
		te(e, t.from);
	}
	function x(e, t) {
		t.restore();
	}
	function S(e, t) {
		return n;
		function n(n, r, i) {
			let a, o, s, u;
			return Array.isArray(n) ? f(n) : "tokenize" in n ? f([n]) : d(n);
			function d(e) {
				return t;
				function t(t) {
					let n = t !== null && e[t], r = t !== null && e.null;
					return f([...Array.isArray(n) ? n : n ? [n] : [], ...Array.isArray(r) ? r : r ? [r] : []])(t);
				}
			}
			function f(e) {
				return a = e, o = 0, e.length === 0 ? i : p(e[o]);
			}
			function p(e) {
				return n;
				function n(n) {
					return u = C(), s = e, e.partial || (l.currentConstruct = e), e.name && l.parser.constructs.disable.null.includes(e.name) ? h(n) : e.tokenize.call(t ? Object.assign(Object.create(l), t) : l, c, m, h)(n);
				}
			}
			function m(t) {
				return e(s, u), r;
			}
			function h(e) {
				return u.restore(), ++o < a.length ? p(a[o]) : i;
			}
		}
	}
	function te(e, t) {
		e.resolveAll && !a.includes(e) && a.push(e), e.resolve && Tt(l.events, t, l.events.length - t, e.resolve(l.events.slice(t), l)), e.resolveTo && (l.events = e.resolveTo(l.events, l));
	}
	function C() {
		let e = m(), t = l.previous, n = l.currentConstruct, i = l.events.length, a = Array.from(s);
		return {
			from: i,
			restore: o
		};
		function o() {
			r = e, l.previous = t, l.currentConstruct = n, l.events.length = i, s = a, w();
		}
	}
	function w() {
		r.line in i && r.column < 2 && (r.column = i[r.line], r.offset += i[r.line] - 1);
	}
}
function ei(e, t) {
	let n = t.start._index, r = t.start._bufferIndex, i = t.end._index, a = t.end._bufferIndex, o;
	if (n === i) o = [e[n].slice(r, a)];
	else {
		if (o = e.slice(n, i), r > -1) {
			let e = o[0];
			typeof e == "string" ? o[0] = e.slice(r) : o.shift();
		}
		a > 0 && o.push(e[i].slice(0, a));
	}
	return o;
}
function ti(e, t) {
	let n = -1, r = [], i;
	for (; ++n < e.length;) {
		let a = e[n], o;
		if (typeof a == "string") o = a;
		else switch (a) {
			case -5:
				o = "\r";
				break;
			case -4:
				o = "\n";
				break;
			case -3:
				o = "\r\n";
				break;
			case -2:
				o = t ? " " : "	";
				break;
			case -1:
				if (!t && i) continue;
				o = " ";
				break;
			default: o = String.fromCharCode(a);
		}
		i = a === -2, r.push(o);
	}
	return r.join("");
}
//#endregion
//#region node_modules/micromark/lib/parse.js
function ni(e) {
	let t = {
		constructs: Ot([Ur, ...(e || {}).extensions || []]),
		content: n(Wt),
		defined: [],
		document: n(Kt),
		flow: n(Fr),
		lazy: {},
		string: n(Rr),
		text: n(zr)
	};
	return t;
	function n(e) {
		return n;
		function n(n) {
			return $r(t, e, n);
		}
	}
}
//#endregion
//#region node_modules/micromark/lib/postprocess.js
function ri(e) {
	for (; !kn(e););
	return e;
}
//#endregion
//#region node_modules/micromark/lib/preprocess.js
var ii = /[\0\t\n\r]/g;
function ai() {
	let e = 1, t = "", n = !0, r;
	return i;
	function i(i, a, o) {
		let s = [], c, l, u, d, f;
		for (i = t + (typeof i == "string" ? i.toString() : new TextDecoder(a || void 0).decode(i)), u = 0, t = "", n &&= (i.charCodeAt(0) === 65279 && u++, void 0); u < i.length;) {
			if (ii.lastIndex = u, c = ii.exec(i), d = c && c.index !== void 0 ? c.index : i.length, f = i.charCodeAt(d), !c) {
				t = i.slice(u);
				break;
			}
			if (f === 10 && u === d && r) s.push(-3), r = void 0;
			else switch (r &&= (s.push(-5), void 0), u < d && (s.push(i.slice(u, d)), e += d - u), f) {
				case 0:
					s.push(65533), e++;
					break;
				case 9:
					for (l = Math.ceil(e / 4) * 4, s.push(-2); e++ < l;) s.push(-1);
					break;
				case 10:
					s.push(-4), e = 1;
					break;
				default: r = !0, e = 1;
			}
			u = d + 1;
		}
		return o && (r && s.push(-5), t && s.push(t), s.push(null)), s;
	}
}
//#endregion
//#region node_modules/micromark-util-decode-string/index.js
var oi = /\\([!-/:-@[-`{-~])|&(#(?:\d{1,7}|x[\da-f]{1,6})|[\da-z]{1,31});/gi;
function si(e) {
	return e.replace(oi, ci);
}
function ci(e, t, n) {
	if (t) return t;
	if (n.charCodeAt(0) === 35) {
		let e = n.charCodeAt(1), t = e === 120 || e === 88;
		return jt(n.slice(t ? 2 : 1), t ? 16 : 10);
	}
	return wt(n) || e;
}
//#endregion
//#region node_modules/mdast-util-from-markdown/lib/index.js
var li = {}.hasOwnProperty;
function ui(e, t, n) {
	return t && typeof t == "object" && (n = t, t = void 0), di(n)(ri(ni(n).document().write(ai()(e, t, !0))));
}
function di(e) {
	let t = {
		transforms: [],
		canContainEols: [
			"emphasis",
			"fragment",
			"heading",
			"paragraph",
			"strong"
		],
		enter: {
			autolink: a(xe),
			autolinkProtocol: C,
			autolinkEmail: C,
			atxHeading: a(_e),
			blockQuote: a(fe),
			characterEscape: C,
			characterReference: C,
			codeFenced: a(pe),
			codeFencedFenceInfo: o,
			codeFencedFenceMeta: o,
			codeIndented: a(pe, o),
			codeText: a(me, o),
			codeTextData: C,
			data: C,
			codeFlowValue: C,
			definition: a(he),
			definitionDestinationString: o,
			definitionLabelString: o,
			definitionTitleString: o,
			emphasis: a(ge),
			hardBreakEscape: a(ve),
			hardBreakTrailing: a(ve),
			htmlFlow: a(ye, o),
			htmlFlowData: C,
			htmlText: a(ye, o),
			htmlTextData: C,
			image: a(be),
			label: o,
			link: a(xe),
			listItem: a(Ce),
			listItemValue: f,
			listOrdered: a(Se, d),
			listUnordered: a(Se),
			paragraph: a(we),
			reference: oe,
			referenceString: o,
			resourceDestinationString: o,
			resourceTitleString: o,
			setextHeading: a(_e),
			strong: a(Te),
			thematicBreak: a(De)
		},
		exit: {
			atxHeading: c(),
			atxHeadingSequence: ee,
			autolink: c(),
			autolinkEmail: de,
			autolinkProtocol: ue,
			blockQuote: c(),
			characterEscapeValue: w,
			characterReferenceMarkerHexadecimal: ce,
			characterReferenceMarkerNumeric: ce,
			characterReferenceValue: le,
			characterReference: N,
			codeFenced: c(g),
			codeFencedFence: h,
			codeFencedFenceInfo: p,
			codeFencedFenceMeta: m,
			codeFlowValue: w,
			codeIndented: c(_),
			codeText: c(ie),
			codeTextData: w,
			data: w,
			definition: c(),
			definitionDestinationString: b,
			definitionLabelString: v,
			definitionTitleString: y,
			emphasis: c(),
			hardBreakEscape: c(T),
			hardBreakTrailing: c(T),
			htmlFlow: c(E),
			htmlFlowData: w,
			htmlText: c(re),
			htmlTextData: w,
			image: c(O),
			label: k,
			labelText: ae,
			lineEnding: ne,
			link: c(D),
			listItem: c(),
			listOrdered: c(),
			listUnordered: c(),
			paragraph: c(),
			referenceString: se,
			resourceDestinationString: A,
			resourceTitleString: j,
			resource: M,
			setextHeading: c(te),
			setextHeadingLineSequence: S,
			setextHeadingText: x,
			strong: c(),
			thematicBreak: c()
		}
	};
	pi(t, (e || {}).mdastExtensions || []);
	let n = {};
	return r;
	function r(e) {
		let r = {
			type: "root",
			children: []
		}, a = {
			stack: [r],
			tokenStack: [],
			config: t,
			enter: s,
			exit: l,
			buffer: o,
			resume: u,
			data: n
		}, c = [], d = -1;
		for (; ++d < e.length;) (e[d][1].type === "listOrdered" || e[d][1].type === "listUnordered") && (e[d][0] === "enter" ? c.push(d) : d = i(e, c.pop(), d));
		for (d = -1; ++d < e.length;) {
			let n = t[e[d][0]];
			li.call(n, e[d][1].type) && n[e[d][1].type].call(Object.assign({ sliceSerialize: e[d][2].sliceSerialize }, a), e[d][1]);
		}
		if (a.tokenStack.length > 0) {
			let e = a.tokenStack[a.tokenStack.length - 1];
			(e[1] || hi).call(a, void 0, e[0]);
		}
		for (r.position = {
			start: fi(e.length > 0 ? e[0][1].start : {
				line: 1,
				column: 1,
				offset: 0
			}),
			end: fi(e.length > 0 ? e[e.length - 2][1].end : {
				line: 1,
				column: 1,
				offset: 0
			})
		}, d = -1; ++d < t.transforms.length;) r = t.transforms[d](r) || r;
		return r;
	}
	function i(e, t, n) {
		let r = t - 1, i = -1, a = !1, o, s, c, l;
		for (; ++r <= n;) {
			let t = e[r];
			switch (t[1].type) {
				case "listUnordered":
				case "listOrdered":
				case "blockQuote":
					t[0] === "enter" ? i++ : i--, l = void 0;
					break;
				case "lineEndingBlank":
					t[0] === "enter" && (o && !l && !i && !c && (c = r), l = void 0);
					break;
				case "linePrefix":
				case "listItemValue":
				case "listItemMarker":
				case "listItemPrefix":
				case "listItemPrefixWhitespace": break;
				default: l = void 0;
			}
			if (!i && t[0] === "enter" && t[1].type === "listItemPrefix" || i === -1 && t[0] === "exit" && (t[1].type === "listUnordered" || t[1].type === "listOrdered")) {
				if (o) {
					let i = r;
					for (s = void 0; i--;) {
						let t = e[i];
						if (t[1].type === "lineEnding" || t[1].type === "lineEndingBlank") {
							if (t[0] === "exit") continue;
							s && (e[s][1].type = "lineEndingBlank", a = !0), t[1].type = "lineEnding", s = i;
						} else if (!(t[1].type === "linePrefix" || t[1].type === "blockQuotePrefix" || t[1].type === "blockQuotePrefixWhitespace" || t[1].type === "blockQuoteMarker" || t[1].type === "listItemIndent")) break;
					}
					c && (!s || c < s) && (o._spread = !0), o.end = Object.assign({}, s ? e[s][1].start : t[1].end), e.splice(s || r, 0, [
						"exit",
						o,
						t[2]
					]), r++, n++;
				}
				if (t[1].type === "listItemPrefix") {
					let i = {
						type: "listItem",
						_spread: !1,
						start: Object.assign({}, t[1].start),
						end: void 0
					};
					o = i, e.splice(r, 0, [
						"enter",
						i,
						t[2]
					]), r++, n++, c = void 0, l = !0;
				}
			}
		}
		return e[t][1]._spread = a, n;
	}
	function a(e, t) {
		return n;
		function n(n) {
			s.call(this, e(n), n), t && t.call(this, n);
		}
	}
	function o() {
		this.stack.push({
			type: "fragment",
			children: []
		});
	}
	function s(e, t, n) {
		this.stack[this.stack.length - 1].children.push(e), this.stack.push(e), this.tokenStack.push([t, n || void 0]), e.position = {
			start: fi(t.start),
			end: void 0
		};
	}
	function c(e) {
		return t;
		function t(t) {
			e && e.call(this, t), l.call(this, t);
		}
	}
	function l(e, t) {
		let n = this.stack.pop(), r = this.tokenStack.pop();
		if (r) r[0].type !== e.type && (t ? t.call(this, e, r[0]) : (r[1] || hi).call(this, e, r[0]));
		else throw Error("Cannot close `" + e.type + "` (" + Ie({
			start: e.start,
			end: e.end
		}) + "): it’s not open");
		n.position.end = fi(e.end);
	}
	function u() {
		return yt(this.stack.pop());
	}
	function d() {
		this.data.expectingFirstListItemValue = !0;
	}
	function f(e) {
		if (this.data.expectingFirstListItemValue) {
			let t = this.stack[this.stack.length - 2];
			t.start = Number.parseInt(this.sliceSerialize(e), 10), this.data.expectingFirstListItemValue = void 0;
		}
	}
	function p() {
		let e = this.resume(), t = this.stack[this.stack.length - 1];
		t.lang = e;
	}
	function m() {
		let e = this.resume(), t = this.stack[this.stack.length - 1];
		t.meta = e;
	}
	function h() {
		this.data.flowCodeInside || (this.buffer(), this.data.flowCodeInside = !0);
	}
	function g() {
		let e = this.resume(), t = this.stack[this.stack.length - 1];
		t.value = e.replace(/^(\r?\n|\r)|(\r?\n|\r)$/g, ""), this.data.flowCodeInside = void 0;
	}
	function _() {
		let e = this.resume(), t = this.stack[this.stack.length - 1];
		t.value = e.replace(/(\r?\n|\r)$/g, "");
	}
	function v(e) {
		let t = this.resume(), n = this.stack[this.stack.length - 1];
		n.label = t, n.identifier = Mt(this.sliceSerialize(e)).toLowerCase();
	}
	function y() {
		let e = this.resume(), t = this.stack[this.stack.length - 1];
		t.title = e;
	}
	function b() {
		let e = this.resume(), t = this.stack[this.stack.length - 1];
		t.url = e;
	}
	function ee(e) {
		let t = this.stack[this.stack.length - 1];
		t.depth ||= this.sliceSerialize(e).length;
	}
	function x() {
		this.data.setextHeadingSlurpLineEnding = !0;
	}
	function S(e) {
		let t = this.stack[this.stack.length - 1];
		t.depth = this.sliceSerialize(e).codePointAt(0) === 61 ? 1 : 2;
	}
	function te() {
		this.data.setextHeadingSlurpLineEnding = void 0;
	}
	function C(e) {
		let t = this.stack[this.stack.length - 1].children, n = t[t.length - 1];
		(!n || n.type !== "text") && (n = Ee(), n.position = {
			start: fi(e.start),
			end: void 0
		}, t.push(n)), this.stack.push(n);
	}
	function w(e) {
		let t = this.stack.pop();
		t.value += this.sliceSerialize(e), t.position.end = fi(e.end);
	}
	function ne(e) {
		let n = this.stack[this.stack.length - 1];
		if (this.data.atHardBreak) {
			let t = n.children[n.children.length - 1];
			t.position.end = fi(e.end), this.data.atHardBreak = void 0;
			return;
		}
		!this.data.setextHeadingSlurpLineEnding && t.canContainEols.includes(n.type) && (C.call(this, e), w.call(this, e));
	}
	function T() {
		this.data.atHardBreak = !0;
	}
	function E() {
		let e = this.resume(), t = this.stack[this.stack.length - 1];
		t.value = e;
	}
	function re() {
		let e = this.resume(), t = this.stack[this.stack.length - 1];
		t.value = e;
	}
	function ie() {
		let e = this.resume(), t = this.stack[this.stack.length - 1];
		t.value = e;
	}
	function D() {
		let e = this.stack[this.stack.length - 1];
		if (this.data.inReference) {
			let t = this.data.referenceType || "shortcut";
			e.type += "Reference", e.referenceType = t, delete e.url, delete e.title;
		} else delete e.identifier, delete e.label;
		this.data.referenceType = void 0;
	}
	function O() {
		let e = this.stack[this.stack.length - 1];
		if (this.data.inReference) {
			let t = this.data.referenceType || "shortcut";
			e.type += "Reference", e.referenceType = t, delete e.url, delete e.title;
		} else delete e.identifier, delete e.label;
		this.data.referenceType = void 0;
	}
	function ae(e) {
		let t = this.sliceSerialize(e), n = this.stack[this.stack.length - 2];
		n.label = si(t), n.identifier = Mt(t).toLowerCase();
	}
	function k() {
		let e = this.stack[this.stack.length - 1], t = this.resume(), n = this.stack[this.stack.length - 1];
		this.data.inReference = !0, n.type === "link" ? n.children = e.children : n.alt = t;
	}
	function A() {
		let e = this.resume(), t = this.stack[this.stack.length - 1];
		t.url = e;
	}
	function j() {
		let e = this.resume(), t = this.stack[this.stack.length - 1];
		t.title = e;
	}
	function M() {
		this.data.inReference = void 0;
	}
	function oe() {
		this.data.referenceType = "collapsed";
	}
	function se(e) {
		let t = this.resume(), n = this.stack[this.stack.length - 1];
		n.label = t, n.identifier = Mt(this.sliceSerialize(e)).toLowerCase(), this.data.referenceType = "full";
	}
	function ce(e) {
		this.data.characterReferenceType = e.type;
	}
	function le(e) {
		let t = this.sliceSerialize(e), n = this.data.characterReferenceType, r;
		n ? (r = jt(t, n === "characterReferenceMarkerNumeric" ? 10 : 16), this.data.characterReferenceType = void 0) : r = wt(t);
		let i = this.stack[this.stack.length - 1];
		i.value += r;
	}
	function N(e) {
		let t = this.stack.pop();
		t.position.end = fi(e.end);
	}
	function ue(e) {
		w.call(this, e);
		let t = this.stack[this.stack.length - 1];
		t.url = this.sliceSerialize(e);
	}
	function de(e) {
		w.call(this, e);
		let t = this.stack[this.stack.length - 1];
		t.url = "mailto:" + this.sliceSerialize(e);
	}
	function fe() {
		return {
			type: "blockquote",
			children: []
		};
	}
	function pe() {
		return {
			type: "code",
			lang: null,
			meta: null,
			value: ""
		};
	}
	function me() {
		return {
			type: "inlineCode",
			value: ""
		};
	}
	function he() {
		return {
			type: "definition",
			identifier: "",
			label: null,
			title: null,
			url: ""
		};
	}
	function ge() {
		return {
			type: "emphasis",
			children: []
		};
	}
	function _e() {
		return {
			type: "heading",
			depth: 0,
			children: []
		};
	}
	function ve() {
		return { type: "break" };
	}
	function ye() {
		return {
			type: "html",
			value: ""
		};
	}
	function be() {
		return {
			type: "image",
			title: null,
			url: "",
			alt: null
		};
	}
	function xe() {
		return {
			type: "link",
			title: null,
			url: "",
			children: []
		};
	}
	function Se(e) {
		return {
			type: "list",
			ordered: e.type === "listOrdered",
			start: null,
			spread: e._spread,
			children: []
		};
	}
	function Ce(e) {
		return {
			type: "listItem",
			spread: e._spread,
			checked: null,
			children: []
		};
	}
	function we() {
		return {
			type: "paragraph",
			children: []
		};
	}
	function Te() {
		return {
			type: "strong",
			children: []
		};
	}
	function Ee() {
		return {
			type: "text",
			value: ""
		};
	}
	function De() {
		return { type: "thematicBreak" };
	}
}
function fi(e) {
	return {
		line: e.line,
		column: e.column,
		offset: e.offset
	};
}
function pi(e, t) {
	let n = -1;
	for (; ++n < t.length;) {
		let r = t[n];
		Array.isArray(r) ? pi(e, r) : mi(e, r);
	}
}
function mi(e, t) {
	let n;
	for (n in t) if (li.call(t, n)) switch (n) {
		case "canContainEols": {
			let r = t[n];
			r && e[n].push(...r);
			break;
		}
		case "transforms": {
			let r = t[n];
			r && e[n].push(...r);
			break;
		}
		case "enter":
		case "exit": {
			let r = t[n];
			r && Object.assign(e[n], r);
			break;
		}
	}
}
function hi(e, t) {
	throw Error(e ? "Cannot close `" + e.type + "` (" + Ie({
		start: e.start,
		end: e.end
	}) + "): a different token (`" + t.type + "`, " + Ie({
		start: t.start,
		end: t.end
	}) + ") is open" : "Cannot close document, a token (`" + t.type + "`, " + Ie({
		start: t.start,
		end: t.end
	}) + ") is still open");
}
//#endregion
//#region node_modules/remark-parse/lib/index.js
function gi(e) {
	let t = this;
	t.parser = n;
	function n(n) {
		return ui(n, {
			...t.data("settings"),
			...e,
			extensions: t.data("micromarkExtensions") || [],
			mdastExtensions: t.data("fromMarkdownExtensions") || []
		});
	}
}
//#endregion
//#region node_modules/mdast-util-to-hast/lib/handlers/blockquote.js
function _i(e, t) {
	let n = {
		type: "element",
		tagName: "blockquote",
		properties: {},
		children: e.wrap(e.all(t), !0)
	};
	return e.patch(t, n), e.applyData(t, n);
}
//#endregion
//#region node_modules/mdast-util-to-hast/lib/handlers/break.js
function vi(e, t) {
	let n = {
		type: "element",
		tagName: "br",
		properties: {},
		children: []
	};
	return e.patch(t, n), [e.applyData(t, n), {
		type: "text",
		value: "\n"
	}];
}
//#endregion
//#region node_modules/mdast-util-to-hast/lib/handlers/code.js
function yi(e, t) {
	let n = t.value ? t.value + "\n" : "", r = {}, i = t.lang ? t.lang.split(/\s+/) : [];
	i.length > 0 && (r.className = ["language-" + i[0]]);
	let a = {
		type: "element",
		tagName: "code",
		properties: r,
		children: [{
			type: "text",
			value: n
		}]
	};
	return t.meta && (a.data = { meta: t.meta }), e.patch(t, a), a = e.applyData(t, a), a = {
		type: "element",
		tagName: "pre",
		properties: {},
		children: [a]
	}, e.patch(t, a), a;
}
//#endregion
//#region node_modules/mdast-util-to-hast/lib/handlers/delete.js
function bi(e, t) {
	let n = {
		type: "element",
		tagName: "del",
		properties: {},
		children: e.all(t)
	};
	return e.patch(t, n), e.applyData(t, n);
}
//#endregion
//#region node_modules/mdast-util-to-hast/lib/handlers/emphasis.js
function xi(e, t) {
	let n = {
		type: "element",
		tagName: "em",
		properties: {},
		children: e.all(t)
	};
	return e.patch(t, n), e.applyData(t, n);
}
//#endregion
//#region node_modules/mdast-util-to-hast/lib/handlers/footnote-reference.js
function Si(e, t) {
	let n = typeof e.options.clobberPrefix == "string" ? e.options.clobberPrefix : "user-content-", r = String(t.identifier).toUpperCase(), i = Ut(r.toLowerCase()), a = e.footnoteOrder.indexOf(r), o, s = e.footnoteCounts.get(r);
	s === void 0 ? (s = 0, e.footnoteOrder.push(r), o = e.footnoteOrder.length) : o = a + 1, s += 1, e.footnoteCounts.set(r, s);
	let c = {
		type: "element",
		tagName: "a",
		properties: {
			href: "#" + n + "fn-" + i,
			id: n + "fnref-" + i + (s > 1 ? "-" + s : ""),
			dataFootnoteRef: !0,
			ariaDescribedBy: ["footnote-label"]
		},
		children: [{
			type: "text",
			value: String(o)
		}]
	};
	e.patch(t, c);
	let l = {
		type: "element",
		tagName: "sup",
		properties: {},
		children: [c]
	};
	return e.patch(t, l), e.applyData(t, l);
}
//#endregion
//#region node_modules/mdast-util-to-hast/lib/handlers/heading.js
function Ci(e, t) {
	let n = {
		type: "element",
		tagName: "h" + t.depth,
		properties: {},
		children: e.all(t)
	};
	return e.patch(t, n), e.applyData(t, n);
}
//#endregion
//#region node_modules/mdast-util-to-hast/lib/handlers/html.js
function wi(e, t) {
	if (e.options.allowDangerousHtml) {
		let n = {
			type: "raw",
			value: t.value
		};
		return e.patch(t, n), e.applyData(t, n);
	}
}
//#endregion
//#region node_modules/mdast-util-to-hast/lib/revert.js
function Ti(e, t) {
	let n = t.referenceType, r = "]";
	if (n === "collapsed" ? r += "[]" : n === "full" && (r += "[" + (t.label || t.identifier) + "]"), t.type === "imageReference") return [{
		type: "text",
		value: "![" + t.alt + r
	}];
	let i = e.all(t), a = i[0];
	a && a.type === "text" ? a.value = "[" + a.value : i.unshift({
		type: "text",
		value: "["
	});
	let o = i[i.length - 1];
	return o && o.type === "text" ? o.value += r : i.push({
		type: "text",
		value: r
	}), i;
}
//#endregion
//#region node_modules/mdast-util-to-hast/lib/handlers/image-reference.js
function Ei(e, t) {
	let n = String(t.identifier).toUpperCase(), r = e.definitionById.get(n);
	if (!r) return Ti(e, t);
	let i = {
		src: Ut(r.url || ""),
		alt: t.alt
	};
	r.title !== null && r.title !== void 0 && (i.title = r.title);
	let a = {
		type: "element",
		tagName: "img",
		properties: i,
		children: []
	};
	return e.patch(t, a), e.applyData(t, a);
}
//#endregion
//#region node_modules/mdast-util-to-hast/lib/handlers/image.js
function Di(e, t) {
	let n = { src: Ut(t.url) };
	t.alt !== null && t.alt !== void 0 && (n.alt = t.alt), t.title !== null && t.title !== void 0 && (n.title = t.title);
	let r = {
		type: "element",
		tagName: "img",
		properties: n,
		children: []
	};
	return e.patch(t, r), e.applyData(t, r);
}
//#endregion
//#region node_modules/mdast-util-to-hast/lib/handlers/inline-code.js
function Oi(e, t) {
	let n = {
		type: "text",
		value: t.value.replace(/\r?\n|\r/g, " ")
	};
	e.patch(t, n);
	let r = {
		type: "element",
		tagName: "code",
		properties: {},
		children: [n]
	};
	return e.patch(t, r), e.applyData(t, r);
}
//#endregion
//#region node_modules/mdast-util-to-hast/lib/handlers/link-reference.js
function ki(e, t) {
	let n = String(t.identifier).toUpperCase(), r = e.definitionById.get(n);
	if (!r) return Ti(e, t);
	let i = { href: Ut(r.url || "") };
	r.title !== null && r.title !== void 0 && (i.title = r.title);
	let a = {
		type: "element",
		tagName: "a",
		properties: i,
		children: e.all(t)
	};
	return e.patch(t, a), e.applyData(t, a);
}
//#endregion
//#region node_modules/mdast-util-to-hast/lib/handlers/link.js
function Ai(e, t) {
	let n = { href: Ut(t.url) };
	t.title !== null && t.title !== void 0 && (n.title = t.title);
	let r = {
		type: "element",
		tagName: "a",
		properties: n,
		children: e.all(t)
	};
	return e.patch(t, r), e.applyData(t, r);
}
//#endregion
//#region node_modules/mdast-util-to-hast/lib/handlers/list-item.js
function R(e, t, n) {
	let r = e.all(t), i = n ? ji(n) : Mi(t), a = {}, o = [];
	if (typeof t.checked == "boolean") {
		let e = r[0], n;
		e && e.type === "element" && e.tagName === "p" ? n = e : (n = {
			type: "element",
			tagName: "p",
			properties: {},
			children: []
		}, r.unshift(n)), n.children.length > 0 && n.children.unshift({
			type: "text",
			value: " "
		}), n.children.unshift({
			type: "element",
			tagName: "input",
			properties: {
				type: "checkbox",
				checked: t.checked,
				disabled: !0
			},
			children: []
		}), a.className = ["task-list-item"];
	}
	let s = -1;
	for (; ++s < r.length;) {
		let e = r[s];
		(i || s !== 0 || e.type !== "element" || e.tagName !== "p") && o.push({
			type: "text",
			value: "\n"
		}), e.type === "element" && e.tagName === "p" && !i ? o.push(...e.children) : o.push(e);
	}
	let c = r[r.length - 1];
	c && (i || c.type !== "element" || c.tagName !== "p") && o.push({
		type: "text",
		value: "\n"
	});
	let l = {
		type: "element",
		tagName: "li",
		properties: a,
		children: o
	};
	return e.patch(t, l), e.applyData(t, l);
}
function ji(e) {
	let t = !1;
	if (e.type === "list") {
		t = e.spread || !1;
		let n = e.children, r = -1;
		for (; !t && ++r < n.length;) t = Mi(n[r]);
	}
	return t;
}
function Mi(e) {
	return e.spread ?? e.children.length > 1;
}
//#endregion
//#region node_modules/mdast-util-to-hast/lib/handlers/list.js
function Ni(e, t) {
	let n = {}, r = e.all(t), i = -1;
	for (typeof t.start == "number" && t.start !== 1 && (n.start = t.start); ++i < r.length;) {
		let e = r[i];
		if (e.type === "element" && e.tagName === "li" && e.properties && Array.isArray(e.properties.className) && e.properties.className.includes("task-list-item")) {
			n.className = ["contains-task-list"];
			break;
		}
	}
	let a = {
		type: "element",
		tagName: t.ordered ? "ol" : "ul",
		properties: n,
		children: e.wrap(r, !0)
	};
	return e.patch(t, a), e.applyData(t, a);
}
//#endregion
//#region node_modules/mdast-util-to-hast/lib/handlers/paragraph.js
function Pi(e, t) {
	let n = {
		type: "element",
		tagName: "p",
		properties: {},
		children: e.all(t)
	};
	return e.patch(t, n), e.applyData(t, n);
}
//#endregion
//#region node_modules/mdast-util-to-hast/lib/handlers/root.js
function Fi(e, t) {
	let n = {
		type: "root",
		children: e.wrap(e.all(t))
	};
	return e.patch(t, n), e.applyData(t, n);
}
//#endregion
//#region node_modules/mdast-util-to-hast/lib/handlers/strong.js
function Ii(e, t) {
	let n = {
		type: "element",
		tagName: "strong",
		properties: {},
		children: e.all(t)
	};
	return e.patch(t, n), e.applyData(t, n);
}
//#endregion
//#region node_modules/mdast-util-to-hast/lib/handlers/table.js
function Li(e, t) {
	let n = e.all(t), r = n.shift(), i = [];
	if (r) {
		let n = {
			type: "element",
			tagName: "thead",
			properties: {},
			children: e.wrap([r], !0)
		};
		e.patch(t.children[0], n), i.push(n);
	}
	if (n.length > 0) {
		let r = {
			type: "element",
			tagName: "tbody",
			properties: {},
			children: e.wrap(n, !0)
		}, a = Ne(t.children[1]), o = Me(t.children[t.children.length - 1]);
		a && o && (r.position = {
			start: a,
			end: o
		}), i.push(r);
	}
	let a = {
		type: "element",
		tagName: "table",
		properties: {},
		children: e.wrap(i, !0)
	};
	return e.patch(t, a), e.applyData(t, a);
}
//#endregion
//#region node_modules/mdast-util-to-hast/lib/handlers/table-row.js
function Ri(e, t, n) {
	let r = n ? n.children : void 0, i = (r ? r.indexOf(t) : 1) === 0 ? "th" : "td", a = n && n.type === "table" ? n.align : void 0, o = a ? a.length : t.children.length, s = -1, c = [];
	for (; ++s < o;) {
		let n = t.children[s], r = {}, o = a ? a[s] : void 0;
		o && (r.align = o);
		let l = {
			type: "element",
			tagName: i,
			properties: r,
			children: []
		};
		n && (l.children = e.all(n), e.patch(n, l), l = e.applyData(n, l)), c.push(l);
	}
	let l = {
		type: "element",
		tagName: "tr",
		properties: {},
		children: e.wrap(c, !0)
	};
	return e.patch(t, l), e.applyData(t, l);
}
//#endregion
//#region node_modules/mdast-util-to-hast/lib/handlers/table-cell.js
function zi(e, t) {
	let n = {
		type: "element",
		tagName: "td",
		properties: {},
		children: e.all(t)
	};
	return e.patch(t, n), e.applyData(t, n);
}
//#endregion
//#region node_modules/trim-lines/index.js
var Bi = 9, Vi = 32;
function Hi(e) {
	let t = String(e), n = /\r?\n|\r/g, r = n.exec(t), i = 0, a = [];
	for (; r;) a.push(Ui(t.slice(i, r.index), i > 0, !0), r[0]), i = r.index + r[0].length, r = n.exec(t);
	return a.push(Ui(t.slice(i), i > 0, !1)), a.join("");
}
function Ui(e, t, n) {
	let r = 0, i = e.length;
	if (t) {
		let t = e.codePointAt(r);
		for (; t === Bi || t === Vi;) r++, t = e.codePointAt(r);
	}
	if (n) {
		let t = e.codePointAt(i - 1);
		for (; t === Bi || t === Vi;) i--, t = e.codePointAt(i - 1);
	}
	return i > r ? e.slice(r, i) : "";
}
//#endregion
//#region node_modules/mdast-util-to-hast/lib/handlers/text.js
function Wi(e, t) {
	let n = {
		type: "text",
		value: Hi(String(t.value))
	};
	return e.patch(t, n), e.applyData(t, n);
}
//#endregion
//#region node_modules/mdast-util-to-hast/lib/handlers/thematic-break.js
function Gi(e, t) {
	let n = {
		type: "element",
		tagName: "hr",
		properties: {},
		children: []
	};
	return e.patch(t, n), e.applyData(t, n);
}
//#endregion
//#region node_modules/mdast-util-to-hast/lib/handlers/index.js
var Ki = {
	blockquote: _i,
	break: vi,
	code: yi,
	delete: bi,
	emphasis: xi,
	footnoteReference: Si,
	heading: Ci,
	html: wi,
	imageReference: Ei,
	image: Di,
	inlineCode: Oi,
	linkReference: ki,
	link: Ai,
	listItem: R,
	list: Ni,
	paragraph: Pi,
	root: Fi,
	strong: Ii,
	table: Li,
	tableCell: zi,
	tableRow: Ri,
	text: Wi,
	thematicBreak: Gi,
	toml: qi,
	yaml: qi,
	definition: qi,
	footnoteDefinition: qi
};
function qi() {}
//#endregion
//#region node_modules/@ungap/structured-clone/esm/deserialize.js
var { defineProperty: Ji } = Object, Yi = typeof self == "object" ? self : globalThis, Xi = (e, t) => {
	switch (e) {
		case "Function":
		case "SharedWorker":
		case "Worker":
		case "eval":
		case "setInterval":
		case "setTimeout": throw TypeError("unable to deserialize " + e);
	}
	return new Yi[e](t);
}, Zi = (e, t) => {
	let n = (t, n) => (e.set(n, t), t), r = (i) => {
		if (e.has(i)) return e.get(i);
		let [a, o] = t[i];
		switch (a) {
			case 0:
			case -1: return n(o, i);
			case 1: {
				let e = n([], i);
				for (let t of o) e.push(r(t));
				return e;
			}
			case 2: {
				let e = n({}, i);
				for (let [t, n] of o) {
					let i = r(t), a = r(n);
					i === "__proto__" ? Ji(e, i, {
						value: a,
						configurable: !0,
						enumerable: !0,
						writable: !0
					}) : e[i] = a;
				}
				return e;
			}
			case 3: return n(new Date(o), i);
			case 4: {
				let { source: e, flags: t } = o;
				return n(new RegExp(e, t), i);
			}
			case 5: {
				let e = n(/* @__PURE__ */ new Map(), i);
				for (let [t, n] of o) e.set(r(t), r(n));
				return e;
			}
			case 6: {
				let e = n(/* @__PURE__ */ new Set(), i);
				for (let t of o) e.add(r(t));
				return e;
			}
			case 7: {
				let { name: e, message: t } = o;
				return n(typeof Yi[e] == "function" ? Xi(e, t) : Error(t), i);
			}
			case 8: return n(BigInt(o), i);
			case "BigInt": return n(Object(BigInt(o)), i);
			case "ArrayBuffer": return n(new Uint8Array(o).buffer, o);
			case "DataView": {
				let { buffer: e } = new Uint8Array(o);
				return n(new DataView(e), o);
			}
			case "-0": return -0;
		}
		return n(Xi(a, o), i);
	};
	return r;
}, Qi = (e) => Zi(/* @__PURE__ */ new Map(), e)(0), $i = "", { toString: ea } = {}, { keys: ta, is: na } = Object, z = (e) => {
	let t = typeof e;
	if (t !== "object" || !e) return [0, t];
	let n = ea.call(e).slice(8, -1);
	switch (n) {
		case "Array": return [1, $i];
		case "Object": return [2, $i];
		case "Date": return [3, $i];
		case "RegExp": return [4, $i];
		case "Map": return [5, $i];
		case "Set": return [6, $i];
		case "DataView": return [1, n];
	}
	return n.includes("Array") ? [1, n] : e instanceof Error ? [7, e.name || "Error"] : [2, n];
}, ra = ([e, t]) => e === 0 && (t === "function" || t === "symbol"), ia = (e, t, n, r) => {
	let i = (e, t) => {
		let i = r.push(e) - 1;
		return n.set(t, i), i;
	}, a = (o) => {
		if (n.has(o)) return n.get(o);
		let [s, c] = z(o);
		switch (s) {
			case 0: {
				let t = o;
				switch (c) {
					case "bigint":
						s = 8, t = o.toString();
						break;
					case "number":
						if (!o && na(o, -0)) return r.push(["-0"]) - 1;
						break;
					case "function":
					case "symbol":
						if (e) throw TypeError("unable to serialize " + c);
						t = null;
						break;
					case "undefined": return i([-1], o);
				}
				return i([s, t], o);
			}
			case 1: {
				if (c) {
					let e = o;
					return c === "DataView" ? e = new Uint8Array(o.buffer) : c === "ArrayBuffer" && (e = new Uint8Array(o)), i([c, [...e]], o);
				}
				let e = [], t = i([s, e], o);
				for (let t of o) e.push(a(t));
				return t;
			}
			case 2: {
				if (c) switch (c) {
					case "BigInt": return i([c, o.toString()], o);
					case "Boolean":
					case "Number":
					case "String": return i([c, o.valueOf()], o);
				}
				if (t && "toJSON" in o) return a(o.toJSON());
				let n = [], r = i([s, n], o);
				for (let t of ta(o)) (e || !ra(z(o[t]))) && n.push([a(t), a(o[t])]);
				return r;
			}
			case 3: return i([s, isNaN(o.getTime()) ? $i : o.toISOString()], o);
			case 4: {
				let { source: e, flags: t } = o;
				return i([s, {
					source: e,
					flags: t
				}], o);
			}
			case 5: {
				let t = [], n = i([s, t], o);
				for (let [n, r] of o) (e || !(ra(z(n)) || ra(z(r)))) && t.push([a(n), a(r)]);
				return n;
			}
			case 6: {
				let t = [], n = i([s, t], o);
				for (let n of o) (e || !ra(z(n))) && t.push(a(n));
				return n;
			}
		}
		let { message: l } = o;
		return i([s, {
			name: c,
			message: l
		}], o);
	};
	return a;
}, aa = (e, { json: t, lossy: n } = {}) => {
	let r = [];
	return ia(!(t || n), !!t, /* @__PURE__ */ new Map(), r)(e), r;
}, oa = typeof structuredClone == "function" ? (e, t) => t && ("json" in t || "lossy" in t) ? Qi(aa(e, t)) : structuredClone(e) : (e, t) => Qi(aa(e, t));
//#endregion
//#region node_modules/mdast-util-to-hast/lib/footer.js
function sa(e, t) {
	let n = [{
		type: "text",
		value: "↩"
	}];
	return t > 1 && n.push({
		type: "element",
		tagName: "sup",
		properties: {},
		children: [{
			type: "text",
			value: String(t)
		}]
	}), n;
}
function ca(e, t) {
	return "Back to reference " + (e + 1) + (t > 1 ? "-" + t : "");
}
function la(e) {
	let t = typeof e.options.clobberPrefix == "string" ? e.options.clobberPrefix : "user-content-", n = e.options.footnoteBackContent || sa, r = e.options.footnoteBackLabel || ca, i = e.options.footnoteLabel || "Footnotes", a = e.options.footnoteLabelTagName || "h2", o = e.options.footnoteLabelProperties || { className: ["sr-only"] }, s = [], c = -1;
	for (; ++c < e.footnoteOrder.length;) {
		let i = e.footnoteById.get(e.footnoteOrder[c]);
		if (!i) continue;
		let a = e.all(i), o = String(i.identifier).toUpperCase(), l = Ut(o.toLowerCase()), u = 0, d = [], f = e.footnoteCounts.get(o);
		for (; f !== void 0 && ++u <= f;) {
			d.length > 0 && d.push({
				type: "text",
				value: " "
			});
			let e = typeof n == "string" ? n : n(c, u);
			typeof e == "string" && (e = {
				type: "text",
				value: e
			}), d.push({
				type: "element",
				tagName: "a",
				properties: {
					href: "#" + t + "fnref-" + l + (u > 1 ? "-" + u : ""),
					dataFootnoteBackref: "",
					ariaLabel: typeof r == "string" ? r : r(c, u),
					className: ["data-footnote-backref"]
				},
				children: Array.isArray(e) ? e : [e]
			});
		}
		let p = a[a.length - 1];
		if (p && p.type === "element" && p.tagName === "p") {
			let e = p.children[p.children.length - 1];
			e && e.type === "text" ? e.value += " " : p.children.push({
				type: "text",
				value: " "
			}), p.children.push(...d);
		} else a.push(...d);
		let m = {
			type: "element",
			tagName: "li",
			properties: { id: t + "fn-" + l },
			children: e.wrap(a, !0)
		};
		e.patch(i, m), s.push(m);
	}
	if (s.length !== 0) return {
		type: "element",
		tagName: "section",
		properties: {
			dataFootnotes: !0,
			className: ["footnotes"]
		},
		children: [
			{
				type: "element",
				tagName: a,
				properties: {
					...oa(o),
					id: "footnote-label"
				},
				children: [{
					type: "text",
					value: i
				}]
			},
			{
				type: "text",
				value: "\n"
			},
			{
				type: "element",
				tagName: "ol",
				properties: {},
				children: e.wrap(s, !0)
			},
			{
				type: "text",
				value: "\n"
			}
		]
	};
}
//#endregion
//#region node_modules/unist-util-is/lib/index.js
var ua = (function(e) {
	if (e == null) return ha;
	if (typeof e == "function") return ma(e);
	if (typeof e == "object") return Array.isArray(e) ? da(e) : fa(e);
	if (typeof e == "string") return pa(e);
	throw Error("Expected function, string, or object as test");
});
function da(e) {
	let t = [], n = -1;
	for (; ++n < e.length;) t[n] = ua(e[n]);
	return ma(r);
	function r(...e) {
		let n = -1;
		for (; ++n < t.length;) if (t[n].apply(this, e)) return !0;
		return !1;
	}
}
function fa(e) {
	let t = e;
	return ma(n);
	function n(n) {
		let r = n, i;
		for (i in e) if (r[i] !== t[i]) return !1;
		return !0;
	}
}
function pa(e) {
	return ma(t);
	function t(t) {
		return t && t.type === e;
	}
}
function ma(e) {
	return t;
	function t(t, n, r) {
		return !!(ga(t) && e.call(this, t, typeof n == "number" ? n : void 0, r || void 0));
	}
}
function ha() {
	return !0;
}
function ga(e) {
	return typeof e == "object" && !!e && "type" in e;
}
//#endregion
//#region node_modules/unist-util-visit-parents/lib/color.js
function _a(e) {
	return e;
}
//#endregion
//#region node_modules/unist-util-visit-parents/lib/index.js
var va = [];
function ya(e, t, n, r) {
	let i;
	typeof t == "function" && typeof n != "function" ? (r = n, n = t) : i = t;
	let a = ua(i), o = r ? -1 : 1;
	s(e, void 0, [])();
	function s(e, i, c) {
		let l = e && typeof e == "object" ? e : {};
		if (typeof l.type == "string") {
			let t = typeof l.tagName == "string" ? l.tagName : typeof l.name == "string" ? l.name : void 0;
			Object.defineProperty(u, "name", { value: "node (" + _a(e.type + (t ? "<" + t + ">" : "")) + ")" });
		}
		return u;
		function u() {
			let l = va, u, d, f;
			if ((!t || a(e, i, c[c.length - 1] || void 0)) && (l = ba(n(e, c)), l[0] === !1)) return l;
			if ("children" in e && e.children) {
				let t = e;
				if (t.children && l[0] !== "skip") for (d = (r ? t.children.length : -1) + o, f = c.concat(t); d > -1 && d < t.children.length;) {
					let e = t.children[d];
					if (u = s(e, d, f)(), u[0] === !1) return u;
					d = typeof u[1] == "number" ? u[1] : d + o;
				}
			}
			return l;
		}
	}
}
function ba(e) {
	return Array.isArray(e) ? e : typeof e == "number" ? [!0, e] : e == null ? va : [e];
}
//#endregion
//#region node_modules/unist-util-visit/lib/index.js
function xa(e, t, n, r) {
	let i, a, o;
	typeof t == "function" && typeof n != "function" ? (a = void 0, o = t, i = n) : (a = t, o = n, i = r), ya(e, a, s, i);
	function s(e, t) {
		let n = t[t.length - 1], r = n ? n.children.indexOf(e) : void 0;
		return o(e, r, n);
	}
}
//#endregion
//#region node_modules/mdast-util-to-hast/lib/state.js
var Sa = {}.hasOwnProperty, Ca = {};
function wa(e, t) {
	let n = t || Ca, r = /* @__PURE__ */ new Map(), i = /* @__PURE__ */ new Map(), a = {
		all: s,
		applyData: Ea,
		definitionById: r,
		footnoteById: i,
		footnoteCounts: /* @__PURE__ */ new Map(),
		footnoteOrder: [],
		handlers: {
			...Ki,
			...n.handlers
		},
		one: o,
		options: n,
		patch: Ta,
		wrap: Oa
	};
	return xa(e, function(e) {
		if (e.type === "definition" || e.type === "footnoteDefinition") {
			let t = e.type === "definition" ? r : i, n = String(e.identifier).toUpperCase();
			t.has(n) || t.set(n, e);
		}
	}), a;
	function o(e, t) {
		let n = e.type, r = a.handlers[n];
		if (Sa.call(a.handlers, n) && r) return r(a, e, t);
		if (a.options.passThrough && a.options.passThrough.includes(n)) {
			if ("children" in e) {
				let { children: t, ...n } = e, r = oa(n);
				return r.children = a.all(e), r;
			}
			return oa(e);
		}
		return (a.options.unknownHandler || Da)(a, e, t);
	}
	function s(e) {
		let t = [];
		if ("children" in e) {
			let n = e.children, r = -1;
			for (; ++r < n.length;) {
				let i = a.one(n[r], e);
				if (i) {
					if (r && n[r - 1].type === "break" && (!Array.isArray(i) && i.type === "text" && (i.value = ka(i.value)), !Array.isArray(i) && i.type === "element")) {
						let e = i.children[0];
						e && e.type === "text" && (e.value = ka(e.value));
					}
					Array.isArray(i) ? t.push(...i) : t.push(i);
				}
			}
		}
		return t;
	}
}
function Ta(e, t) {
	e.position && (t.position = Fe(e));
}
function Ea(e, t) {
	let n = t;
	if (e && e.data) {
		let t = e.data.hName, r = e.data.hChildren, i = e.data.hProperties;
		typeof t == "string" && (n.type === "element" ? n.tagName = t : n = {
			type: "element",
			tagName: t,
			properties: {},
			children: "children" in n ? n.children : [n]
		}), n.type === "element" && i && Object.assign(n.properties, oa(i)), "children" in n && n.children && r != null && (n.children = r);
	}
	return n;
}
function Da(e, t) {
	let n = t.data || {}, r = "value" in t && !(Sa.call(n, "hProperties") || Sa.call(n, "hChildren")) ? {
		type: "text",
		value: t.value
	} : {
		type: "element",
		tagName: "div",
		properties: {},
		children: e.all(t)
	};
	return e.patch(t, r), e.applyData(t, r);
}
function Oa(e, t) {
	let n = [], r = -1;
	for (t && n.push({
		type: "text",
		value: "\n"
	}); ++r < e.length;) r && n.push({
		type: "text",
		value: "\n"
	}), n.push(e[r]);
	return t && e.length > 0 && n.push({
		type: "text",
		value: "\n"
	}), n;
}
function ka(e) {
	let t = 0, n = e.charCodeAt(t);
	for (; n === 9 || n === 32;) t++, n = e.charCodeAt(t);
	return e.slice(t);
}
//#endregion
//#region node_modules/mdast-util-to-hast/lib/index.js
function Aa(e, t) {
	let n = wa(e, t), r = n.one(e, void 0), i = la(n), a = Array.isArray(r) ? {
		type: "root",
		children: r
	} : r || {
		type: "root",
		children: []
	};
	return i && ("children" in a, a.children.push({
		type: "text",
		value: "\n"
	}, i)), a;
}
//#endregion
//#region node_modules/remark-rehype/lib/index.js
function ja(e, t) {
	return e && "run" in e ? async function(n, r) {
		let i = Aa(n, {
			file: r,
			...t
		});
		await e.run(i, r);
	} : function(n, r) {
		return Aa(n, {
			file: r,
			...e || t
		});
	};
}
//#endregion
//#region node_modules/bail/index.js
function Ma(e) {
	if (e) throw e;
}
//#endregion
//#region node_modules/extend/index.js
var Na = /* @__PURE__ */ o(((e, t) => {
	var n = Object.prototype.hasOwnProperty, r = Object.prototype.toString, i = Object.defineProperty, a = Object.getOwnPropertyDescriptor, o = function(e) {
		return typeof Array.isArray == "function" ? Array.isArray(e) : r.call(e) === "[object Array]";
	}, s = function(e) {
		if (!e || r.call(e) !== "[object Object]") return !1;
		var t = n.call(e, "constructor"), i = e.constructor && e.constructor.prototype && n.call(e.constructor.prototype, "isPrototypeOf");
		if (e.constructor && !t && !i) return !1;
		for (var a in e);
		return a === void 0 || n.call(e, a);
	}, c = function(e, t) {
		i && t.name === "__proto__" ? i(e, t.name, {
			enumerable: !0,
			configurable: !0,
			value: t.newValue,
			writable: !0
		}) : e[t.name] = t.newValue;
	}, l = function(e, t) {
		if (t === "__proto__") {
			if (!n.call(e, t)) return;
			if (a) return a(e, t).value;
		}
		return e[t];
	};
	t.exports = function e() {
		var t, n, r, i, a, u, d = arguments[0], f = 1, p = arguments.length, m = !1;
		for (typeof d == "boolean" && (m = d, d = arguments[1] || {}, f = 2), (d == null || typeof d != "object" && typeof d != "function") && (d = {}); f < p; ++f) if (t = arguments[f], t != null) for (n in t) r = l(d, n), i = l(t, n), d !== i && (m && i && (s(i) || (a = o(i))) ? (a ? (a = !1, u = r && o(r) ? r : []) : u = r && s(r) ? r : {}, c(d, {
			name: n,
			newValue: e(m, u, i)
		})) : i !== void 0 && c(d, {
			name: n,
			newValue: i
		}));
		return d;
	};
}));
//#endregion
//#region node_modules/is-plain-obj/index.js
function Pa(e) {
	if (typeof e != "object" || !e) return !1;
	let t = Object.getPrototypeOf(e);
	return (t === null || t === Object.prototype || Object.getPrototypeOf(t) === null) && !(Symbol.toStringTag in e) && !(Symbol.iterator in e);
}
//#endregion
//#region node_modules/trough/lib/index.js
function Fa() {
	let e = [], t = {
		run: n,
		use: r
	};
	return t;
	function n(...t) {
		let n = -1, r = t.pop();
		if (typeof r != "function") throw TypeError("Expected function as last argument, not " + r);
		i(null, ...t);
		function i(a, ...o) {
			let s = e[++n], c = -1;
			if (a) {
				r(a);
				return;
			}
			for (; ++c < t.length;) (o[c] === null || o[c] === void 0) && (o[c] = t[c]);
			t = o, s ? Ia(s, i)(...o) : r(null, ...o);
		}
	}
	function r(n) {
		if (typeof n != "function") throw TypeError("Expected `middelware` to be a function, not " + n);
		return e.push(n), t;
	}
}
function Ia(e, t) {
	let n;
	return r;
	function r(...t) {
		let r = e.length > t.length, o;
		r && t.push(i);
		try {
			o = e.apply(this, t);
		} catch (e) {
			let t = e;
			if (r && n) throw t;
			return i(t);
		}
		r || (o && o.then && typeof o.then == "function" ? o.then(a, i) : o instanceof Error ? i(o) : a(o));
	}
	function i(e, ...r) {
		n || (n = !0, t(e, ...r));
	}
	function a(e) {
		i(null, e);
	}
}
//#endregion
//#region node_modules/vfile/lib/minpath.browser.js
var La = {
	basename: Ra,
	dirname: za,
	extname: Ba,
	join: Va,
	sep: "/"
};
function Ra(e, t) {
	if (t !== void 0 && typeof t != "string") throw TypeError("\"ext\" argument must be a string");
	Wa(e);
	let n = 0, r = -1, i = e.length, a;
	if (t === void 0 || t.length === 0 || t.length > e.length) {
		for (; i--;) if (e.codePointAt(i) === 47) {
			if (a) {
				n = i + 1;
				break;
			}
		} else r < 0 && (a = !0, r = i + 1);
		return r < 0 ? "" : e.slice(n, r);
	}
	if (t === e) return "";
	let o = -1, s = t.length - 1;
	for (; i--;) if (e.codePointAt(i) === 47) {
		if (a) {
			n = i + 1;
			break;
		}
	} else o < 0 && (a = !0, o = i + 1), s > -1 && (e.codePointAt(i) === t.codePointAt(s--) ? s < 0 && (r = i) : (s = -1, r = o));
	return n === r ? r = o : r < 0 && (r = e.length), e.slice(n, r);
}
function za(e) {
	if (Wa(e), e.length === 0) return ".";
	let t = -1, n = e.length, r;
	for (; --n;) if (e.codePointAt(n) === 47) {
		if (r) {
			t = n;
			break;
		}
	} else r ||= !0;
	return t < 0 ? e.codePointAt(0) === 47 ? "/" : "." : t === 1 && e.codePointAt(0) === 47 ? "//" : e.slice(0, t);
}
function Ba(e) {
	Wa(e);
	let t = e.length, n = -1, r = 0, i = -1, a = 0, o;
	for (; t--;) {
		let s = e.codePointAt(t);
		if (s === 47) {
			if (o) {
				r = t + 1;
				break;
			}
			continue;
		}
		n < 0 && (o = !0, n = t + 1), s === 46 ? i < 0 ? i = t : a !== 1 && (a = 1) : i > -1 && (a = -1);
	}
	return i < 0 || n < 0 || a === 0 || a === 1 && i === n - 1 && i === r + 1 ? "" : e.slice(i, n);
}
function Va(...e) {
	let t = -1, n;
	for (; ++t < e.length;) Wa(e[t]), e[t] && (n = n === void 0 ? e[t] : n + "/" + e[t]);
	return n === void 0 ? "." : Ha(n);
}
function Ha(e) {
	Wa(e);
	let t = e.codePointAt(0) === 47, n = Ua(e, !t);
	return n.length === 0 && !t && (n = "."), n.length > 0 && e.codePointAt(e.length - 1) === 47 && (n += "/"), t ? "/" + n : n;
}
function Ua(e, t) {
	let n = "", r = 0, i = -1, a = 0, o = -1, s, c;
	for (; ++o <= e.length;) {
		if (o < e.length) s = e.codePointAt(o);
		else if (s === 47) break;
		else s = 47;
		if (s === 47) {
			if (!(i === o - 1 || a === 1)) if (i !== o - 1 && a === 2) {
				if (n.length < 2 || r !== 2 || n.codePointAt(n.length - 1) !== 46 || n.codePointAt(n.length - 2) !== 46) {
					if (n.length > 2) {
						if (c = n.lastIndexOf("/"), c !== n.length - 1) {
							c < 0 ? (n = "", r = 0) : (n = n.slice(0, c), r = n.length - 1 - n.lastIndexOf("/")), i = o, a = 0;
							continue;
						}
					} else if (n.length > 0) {
						n = "", r = 0, i = o, a = 0;
						continue;
					}
				}
				t && (n = n.length > 0 ? n + "/.." : "..", r = 2);
			} else n.length > 0 ? n += "/" + e.slice(i + 1, o) : n = e.slice(i + 1, o), r = o - i - 1;
			i = o, a = 0;
		} else s === 46 && a > -1 ? a++ : a = -1;
	}
	return n;
}
function Wa(e) {
	if (typeof e != "string") throw TypeError("Path must be a string. Received " + JSON.stringify(e));
}
//#endregion
//#region node_modules/vfile/lib/minproc.browser.js
var B = { cwd: V };
function V() {
	return "/";
}
//#endregion
//#region node_modules/vfile/lib/minurl.shared.js
function Ga(e) {
	return !!(typeof e == "object" && e && "href" in e && e.href && "protocol" in e && e.protocol && e.auth === void 0);
}
//#endregion
//#region node_modules/vfile/lib/minurl.browser.js
function Ka(e) {
	if (typeof e == "string") e = new URL(e);
	else if (!Ga(e)) {
		let t = /* @__PURE__ */ TypeError("The \"path\" argument must be of type string or an instance of URL. Received `" + e + "`");
		throw t.code = "ERR_INVALID_ARG_TYPE", t;
	}
	if (e.protocol !== "file:") {
		let e = /* @__PURE__ */ TypeError("The URL must be of scheme file");
		throw e.code = "ERR_INVALID_URL_SCHEME", e;
	}
	return qa(e);
}
function qa(e) {
	if (e.hostname !== "") {
		let e = /* @__PURE__ */ TypeError("File URL host must be \"localhost\" or empty on darwin");
		throw e.code = "ERR_INVALID_FILE_URL_HOST", e;
	}
	let t = e.pathname, n = -1;
	for (; ++n < t.length;) if (t.codePointAt(n) === 37 && t.codePointAt(n + 1) === 50) {
		let e = t.codePointAt(n + 2);
		if (e === 70 || e === 102) {
			let e = /* @__PURE__ */ TypeError("File URL path must not include encoded / characters");
			throw e.code = "ERR_INVALID_FILE_URL_PATH", e;
		}
	}
	return decodeURIComponent(t);
}
//#endregion
//#region node_modules/vfile/lib/index.js
var Ja = [
	"history",
	"path",
	"basename",
	"stem",
	"extname",
	"dirname"
], Ya = class {
	constructor(e) {
		let t;
		t = e ? Ga(e) ? { path: e } : typeof e == "string" || $a(e) ? { value: e } : e : {}, this.cwd = "cwd" in t ? "" : B.cwd(), this.data = {}, this.history = [], this.messages = [], this.value, this.map, this.result, this.stored;
		let n = -1;
		for (; ++n < Ja.length;) {
			let e = Ja[n];
			e in t && t[e] !== void 0 && t[e] !== null && (this[e] = e === "history" ? [...t[e]] : t[e]);
		}
		let r;
		for (r in t) Ja.includes(r) || (this[r] = t[r]);
	}
	get basename() {
		return typeof this.path == "string" ? La.basename(this.path) : void 0;
	}
	set basename(e) {
		Za(e, "basename"), Xa(e, "basename"), this.path = La.join(this.dirname || "", e);
	}
	get dirname() {
		return typeof this.path == "string" ? La.dirname(this.path) : void 0;
	}
	set dirname(e) {
		Qa(this.basename, "dirname"), this.path = La.join(e || "", this.basename);
	}
	get extname() {
		return typeof this.path == "string" ? La.extname(this.path) : void 0;
	}
	set extname(e) {
		if (Xa(e, "extname"), Qa(this.dirname, "extname"), e) {
			if (e.codePointAt(0) !== 46) throw Error("`extname` must start with `.`");
			if (e.includes(".", 1)) throw Error("`extname` cannot contain multiple dots");
		}
		this.path = La.join(this.dirname, this.stem + (e || ""));
	}
	get path() {
		return this.history[this.history.length - 1];
	}
	set path(e) {
		Ga(e) && (e = Ka(e)), Za(e, "path"), this.path !== e && this.history.push(e);
	}
	get stem() {
		return typeof this.path == "string" ? La.basename(this.path, this.extname) : void 0;
	}
	set stem(e) {
		Za(e, "stem"), Xa(e, "stem"), this.path = La.join(this.dirname || "", e + (this.extname || ""));
	}
	fail(e, t, n) {
		let r = this.message(e, t, n);
		throw r.fatal = !0, r;
	}
	info(e, t, n) {
		let r = this.message(e, t, n);
		return r.fatal = void 0, r;
	}
	message(e, t, n) {
		let r = new Be(e, t, n);
		return this.path && (r.name = this.path + ":" + r.name, r.file = this.path), r.fatal = !1, this.messages.push(r), r;
	}
	toString(e) {
		return this.value === void 0 ? "" : typeof this.value == "string" ? this.value : new TextDecoder(e || void 0).decode(this.value);
	}
};
function Xa(e, t) {
	if (e && e.includes(La.sep)) throw Error("`" + t + "` cannot be a path: did not expect `" + La.sep + "`");
}
function Za(e, t) {
	if (!e) throw Error("`" + t + "` cannot be empty");
}
function Qa(e, t) {
	if (!e) throw Error("Setting `" + t + "` requires `path` to be set too");
}
function $a(e) {
	return !!(e && typeof e == "object" && "byteLength" in e && "byteOffset" in e);
}
//#endregion
//#region node_modules/unified/lib/callable-instance.js
var eo = (function(e) {
	let t = this.constructor.prototype, n = t[e], r = function() {
		return n.apply(r, arguments);
	};
	return Object.setPrototypeOf(r, t), r;
}), to = /* @__PURE__ */ l(Na(), 1), no = {}.hasOwnProperty, ro = new class e extends eo {
	constructor() {
		super("copy"), this.Compiler = void 0, this.Parser = void 0, this.attachers = [], this.compiler = void 0, this.freezeIndex = -1, this.frozen = void 0, this.namespace = {}, this.parser = void 0, this.transformers = Fa();
	}
	copy() {
		let t = new e(), n = -1;
		for (; ++n < this.attachers.length;) {
			let e = this.attachers[n];
			t.use(...e);
		}
		return t.data((0, to.default)(!0, {}, this.namespace)), t;
	}
	data(e, t) {
		return typeof e == "string" ? arguments.length === 2 ? (oo("data", this.frozen), this.namespace[e] = t, this) : no.call(this.namespace, e) && this.namespace[e] || void 0 : e ? (oo("data", this.frozen), this.namespace = e, this) : this.namespace;
	}
	freeze() {
		if (this.frozen) return this;
		let e = this;
		for (; ++this.freezeIndex < this.attachers.length;) {
			let [t, ...n] = this.attachers[this.freezeIndex];
			if (n[0] === !1) continue;
			n[0] === !0 && (n[0] = void 0);
			let r = t.call(e, ...n);
			typeof r == "function" && this.transformers.use(r);
		}
		return this.frozen = !0, this.freezeIndex = Infinity, this;
	}
	parse(e) {
		this.freeze();
		let t = lo(e), n = this.parser || this.Parser;
		return io("parse", n), n(String(t), t);
	}
	process(e, t) {
		let n = this;
		return this.freeze(), io("process", this.parser || this.Parser), ao("process", this.compiler || this.Compiler), t ? r(void 0, t) : new Promise(r);
		function r(r, i) {
			let a = lo(e), o = n.parse(a);
			n.run(o, a, function(e, t, r) {
				if (e || !t || !r) return s(e);
				let i = t, a = n.stringify(i, r);
				fo(a) ? r.value = a : r.result = a, s(e, r);
			});
			function s(e, n) {
				e || !n ? i(e) : r ? r(n) : t(void 0, n);
			}
		}
	}
	processSync(e) {
		let t = !1, n;
		return this.freeze(), io("processSync", this.parser || this.Parser), ao("processSync", this.compiler || this.Compiler), this.process(e, r), co("processSync", "process", t), n;
		function r(e, r) {
			t = !0, Ma(e), n = r;
		}
	}
	run(e, t, n) {
		so(e), this.freeze();
		let r = this.transformers;
		return !n && typeof t == "function" && (n = t, t = void 0), n ? i(void 0, n) : new Promise(i);
		function i(i, a) {
			let o = lo(t);
			r.run(e, o, s);
			function s(t, r, o) {
				let s = r || e;
				t ? a(t) : i ? i(s) : n(void 0, s, o);
			}
		}
	}
	runSync(e, t) {
		let n = !1, r;
		return this.run(e, t, i), co("runSync", "run", n), r;
		function i(e, t) {
			Ma(e), r = t, n = !0;
		}
	}
	stringify(e, t) {
		this.freeze();
		let n = lo(t), r = this.compiler || this.Compiler;
		return ao("stringify", r), so(e), r(e, n);
	}
	use(e, ...t) {
		let n = this.attachers, r = this.namespace;
		if (oo("use", this.frozen), e != null) if (typeof e == "function") s(e, t);
		else if (typeof e == "object") Array.isArray(e) ? o(e) : a(e);
		else throw TypeError("Expected usable value, not `" + e + "`");
		return this;
		function i(e) {
			if (typeof e == "function") s(e, []);
			else if (typeof e == "object") if (Array.isArray(e)) {
				let [t, ...n] = e;
				s(t, n);
			} else a(e);
			else throw TypeError("Expected usable value, not `" + e + "`");
		}
		function a(e) {
			if (!("plugins" in e) && !("settings" in e)) throw Error("Expected usable value but received an empty preset, which is probably a mistake: presets typically come with `plugins` and sometimes with `settings`, but this has neither");
			o(e.plugins), e.settings && (r.settings = (0, to.default)(!0, r.settings, e.settings));
		}
		function o(e) {
			let t = -1;
			if (e != null) if (Array.isArray(e)) for (; ++t < e.length;) {
				let n = e[t];
				i(n);
			}
			else throw TypeError("Expected a list of plugins, not `" + e + "`");
		}
		function s(e, t) {
			let r = -1, i = -1;
			for (; ++r < n.length;) if (n[r][0] === e) {
				i = r;
				break;
			}
			if (i === -1) n.push([e, ...t]);
			else if (t.length > 0) {
				let [r, ...a] = t, o = n[i][1];
				Pa(o) && Pa(r) && (r = (0, to.default)(!0, o, r)), n[i] = [
					e,
					r,
					...a
				];
			}
		}
	}
}().freeze();
function io(e, t) {
	if (typeof t != "function") throw TypeError("Cannot `" + e + "` without `parser`");
}
function ao(e, t) {
	if (typeof t != "function") throw TypeError("Cannot `" + e + "` without `compiler`");
}
function oo(e, t) {
	if (t) throw Error("Cannot call `" + e + "` on a frozen processor.\nCreate a new processor first, by calling it: use `processor()` instead of `processor`.");
}
function so(e) {
	if (!Pa(e) || typeof e.type != "string") throw TypeError("Expected node, got `" + e + "`");
}
function co(e, t, n) {
	if (!n) throw Error("`" + e + "` finished async. Use `" + t + "` instead");
}
function lo(e) {
	return uo(e) ? e : new Ya(e);
}
function uo(e) {
	return !!(e && typeof e == "object" && "message" in e && "messages" in e);
}
function fo(e) {
	return typeof e == "string" || po(e);
}
function po(e) {
	return !!(e && typeof e == "object" && "byteLength" in e && "byteOffset" in e);
}
//#endregion
//#region node_modules/react-markdown/lib/index.js
var H = _t(), U = p(), mo = [], ho = { allowDangerousHtml: !0 }, go = /^(https?|ircs?|mailto|xmpp)$/i, _o = [
	{
		from: "astPlugins",
		id: "remove-buggy-html-in-markdown-parser"
	},
	{
		from: "allowDangerousHtml",
		id: "remove-buggy-html-in-markdown-parser"
	},
	{
		from: "allowNode",
		id: "replace-allownode-allowedtypes-and-disallowedtypes",
		to: "allowElement"
	},
	{
		from: "allowedTypes",
		id: "replace-allownode-allowedtypes-and-disallowedtypes",
		to: "allowedElements"
	},
	{
		from: "className",
		id: "remove-classname"
	},
	{
		from: "disallowedTypes",
		id: "replace-allownode-allowedtypes-and-disallowedtypes",
		to: "disallowedElements"
	},
	{
		from: "escapeHtml",
		id: "remove-buggy-html-in-markdown-parser"
	},
	{
		from: "includeElementIndex",
		id: "#remove-includeelementindex"
	},
	{
		from: "includeNodeIndex",
		id: "change-includenodeindex-to-includeelementindex"
	},
	{
		from: "linkTarget",
		id: "remove-linktarget"
	},
	{
		from: "plugins",
		id: "change-plugins-to-remarkplugins",
		to: "remarkPlugins"
	},
	{
		from: "rawSourcePos",
		id: "#remove-rawsourcepos"
	},
	{
		from: "renderers",
		id: "change-renderers-to-components",
		to: "components"
	},
	{
		from: "source",
		id: "change-source-to-children",
		to: "children"
	},
	{
		from: "sourcePos",
		id: "#remove-sourcepos"
	},
	{
		from: "transformImageUri",
		id: "#add-urltransform",
		to: "urlTransform"
	},
	{
		from: "transformLinkUri",
		id: "#add-urltransform",
		to: "urlTransform"
	}
];
function vo(e) {
	let t = yo(e), n = bo(e);
	return xo(t.runSync(t.parse(n), n), e);
}
function yo(e) {
	let t = e.rehypePlugins || mo, n = e.remarkPlugins || mo, r = e.remarkRehypeOptions ? {
		...e.remarkRehypeOptions,
		...ho
	} : ho;
	return ro().use(gi).use(n).use(ja, r).use(t);
}
function bo(e) {
	let t = e.children || "", n = new Ya();
	return typeof t == "string" ? n.value = t : "" + t, n;
}
function xo(e, t) {
	let n = t.allowedElements, r = t.allowElement, i = t.components, a = t.disallowedElements, o = t.skipHtml, s = t.unwrapDisallowed, c = t.urlTransform || So;
	for (let e of _o) Object.hasOwn(t, e.from) && "" + e.from + (e.to ? "use `" + e.to + "` instead" : "remove it") + e.id;
	return xa(e, l), qe(e, {
		Fragment: H.Fragment,
		components: i,
		ignoreInvalidStyle: !0,
		jsx: H.jsx,
		jsxs: H.jsxs,
		passKeys: !0,
		passNode: !0
	});
	function l(e, t, i) {
		if (e.type === "raw" && i && typeof t == "number") return o ? i.children.splice(t, 1) : i.children[t] = {
			type: "text",
			value: e.value
		}, t;
		if (e.type === "element") {
			let t;
			for (t in ht) if (Object.hasOwn(ht, t) && Object.hasOwn(e.properties, t)) {
				let n = e.properties[t], r = ht[t];
				(r === null || r.includes(e.tagName)) && (e.properties[t] = c(String(n || ""), t, e));
			}
		}
		if (e.type === "element") {
			let o = n ? !n.includes(e.tagName) : a ? a.includes(e.tagName) : !1;
			if (!o && r && typeof t == "number" && (o = !r(e, t, i)), o && i && typeof t == "number") return s && e.children ? i.children.splice(t, 1, ...e.children) : i.children.splice(t, 1), t;
		}
	}
}
function So(e) {
	let t = e.indexOf(":"), n = e.indexOf("?"), r = e.indexOf("#"), i = e.indexOf("/");
	return t === -1 || i !== -1 && t > i || n !== -1 && t > n || r !== -1 && t > r || go.test(e.slice(0, t)) ? e : "";
}
//#endregion
//#region node_modules/ccount/index.js
function Co(e, t) {
	let n = String(e);
	if (typeof t != "string") throw TypeError("Expected character");
	let r = 0, i = n.indexOf(t);
	for (; i !== -1;) r++, i = n.indexOf(t, i + t.length);
	return r;
}
//#endregion
//#region node_modules/mdast-util-find-and-replace/node_modules/escape-string-regexp/index.js
function wo(e) {
	if (typeof e != "string") throw TypeError("Expected a string");
	return e.replace(/[|\\{}()[\]^$+*?.]/g, "\\$&").replace(/-/g, "\\x2d");
}
//#endregion
//#region node_modules/mdast-util-find-and-replace/lib/index.js
function To(e, t, n) {
	let r = ua((n || {}).ignore || []), i = Eo(t), a = -1;
	for (; ++a < i.length;) ya(e, "text", o);
	function o(e, t) {
		let n = -1, i;
		for (; ++n < t.length;) {
			let e = t[n], a = i ? i.children : void 0;
			if (r(e, a ? a.indexOf(e) : void 0, i)) return;
			i = e;
		}
		if (i) return s(e, t);
	}
	function s(e, t) {
		let n = t[t.length - 1], r = i[a][0], o = i[a][1], s = 0, c = n.children.indexOf(e), l = !1, u = [];
		r.lastIndex = 0;
		let d = r.exec(e.value);
		for (; d;) {
			let n = d.index, i = {
				index: d.index,
				input: d.input,
				stack: [...t, e]
			}, a = o(...d, i);
			if (typeof a == "string" && (a = a.length > 0 ? {
				type: "text",
				value: a
			} : void 0), a === !1 ? r.lastIndex = n + 1 : (s !== n && u.push({
				type: "text",
				value: e.value.slice(s, n)
			}), Array.isArray(a) ? u.push(...a) : a && u.push(a), s = n + d[0].length, l = !0), !r.global) break;
			d = r.exec(e.value);
		}
		return l ? (s < e.value.length && u.push({
			type: "text",
			value: e.value.slice(s)
		}), n.children.splice(c, 1, ...u)) : u = [e], c + u.length;
	}
}
function Eo(e) {
	let t = [];
	if (!Array.isArray(e)) throw TypeError("Expected find and replace tuple or list of tuples");
	let n = !e[0] || Array.isArray(e[0]) ? e : [e], r = -1;
	for (; ++r < n.length;) {
		let e = n[r];
		t.push([Do(e[0]), Oo(e[1])]);
	}
	return t;
}
function Do(e) {
	return typeof e == "string" ? new RegExp(wo(e), "g") : e;
}
function Oo(e) {
	return typeof e == "function" ? e : function() {
		return e;
	};
}
//#endregion
//#region node_modules/mdast-util-gfm-autolink-literal/lib/index.js
var ko = "phrasing", Ao = [
	"autolink",
	"link",
	"image",
	"label"
];
function jo() {
	return {
		transforms: [zo],
		enter: {
			literalAutolink: No,
			literalAutolinkEmail: Po,
			literalAutolinkHttp: Po,
			literalAutolinkWww: Po
		},
		exit: {
			literalAutolink: Ro,
			literalAutolinkEmail: Lo,
			literalAutolinkHttp: Fo,
			literalAutolinkWww: Io
		}
	};
}
function Mo() {
	return { unsafe: [
		{
			character: "@",
			before: "[+\\-.\\w]",
			after: "[\\-.\\w]",
			inConstruct: ko,
			notInConstruct: Ao
		},
		{
			character: ".",
			before: "[Ww]",
			after: "[\\-.\\w]",
			inConstruct: ko,
			notInConstruct: Ao
		},
		{
			character: ":",
			before: "[ps]",
			after: "\\/",
			inConstruct: ko,
			notInConstruct: Ao
		}
	] };
}
function No(e) {
	this.enter({
		type: "link",
		title: null,
		url: "",
		children: []
	}, e);
}
function Po(e) {
	this.config.enter.autolinkProtocol.call(this, e);
}
function Fo(e) {
	this.config.exit.autolinkProtocol.call(this, e);
}
function Io(e) {
	this.config.exit.data.call(this, e);
	let t = this.stack[this.stack.length - 1];
	t.type, t.url = "http://" + this.sliceSerialize(e);
}
function Lo(e) {
	this.config.exit.autolinkEmail.call(this, e);
}
function Ro(e) {
	this.exit(e);
}
function zo(e) {
	To(e, [[/(https?:\/\/|www(?=\.))([-.\w]+)([^ \t\r\n]*)/gi, Bo], [/(?<=^|\s|\p{P}|\p{S})([-.\w+]+)@([-\w]+(?:\.[-\w]+)+)/gu, Vo]], { ignore: ["link", "linkReference"] });
}
function Bo(e, t, n, r, i) {
	let a = "";
	if (!Wo(i) || (/^w/i.test(t) && (n = t + n, t = "", a = "http://"), !Ho(n))) return !1;
	let o = Uo(n + r);
	if (!o[0]) return !1;
	let s = {
		type: "link",
		title: null,
		url: a + t + o[0],
		children: [{
			type: "text",
			value: t + o[0]
		}]
	};
	return o[1] ? [s, {
		type: "text",
		value: o[1]
	}] : s;
}
function Vo(e, t, n, r) {
	return !Wo(r, !0) || /[-\d_]$/.test(n) ? !1 : {
		type: "link",
		title: null,
		url: "mailto:" + t + "@" + n,
		children: [{
			type: "text",
			value: t + "@" + n
		}]
	};
}
function Ho(e) {
	let t = e.split(".");
	return !(t.length < 2 || t[t.length - 1] && (/_/.test(t[t.length - 1]) || !/[a-zA-Z\d]/.test(t[t.length - 1])) || t[t.length - 2] && (/_/.test(t[t.length - 2]) || !/[a-zA-Z\d]/.test(t[t.length - 2])));
}
function Uo(e) {
	let t = /[!"&'),.:;<>?\]}]+$/.exec(e);
	if (!t) return [e, void 0];
	e = e.slice(0, t.index);
	let n = t[0], r = n.indexOf(")"), i = Co(e, "("), a = Co(e, ")");
	for (; r !== -1 && i > a;) e += n.slice(0, r + 1), n = n.slice(r + 1), r = n.indexOf(")"), a++;
	return [e, n];
}
function Wo(e, t) {
	let n = e.input.charCodeAt(e.index - 1);
	return (e.index === 0 || Vt(n) || Bt(n)) && (!t || n !== 47);
}
//#endregion
//#region node_modules/mdast-util-gfm-footnote/lib/index.js
es.peek = $o;
function Go() {
	this.buffer();
}
function Ko(e) {
	this.enter({
		type: "footnoteReference",
		identifier: "",
		label: ""
	}, e);
}
function qo() {
	this.buffer();
}
function Jo(e) {
	this.enter({
		type: "footnoteDefinition",
		identifier: "",
		label: "",
		children: []
	}, e);
}
function Yo(e) {
	let t = this.resume(), n = this.stack[this.stack.length - 1];
	n.type, n.identifier = Mt(this.sliceSerialize(e)).toLowerCase(), n.label = t;
}
function Xo(e) {
	this.exit(e);
}
function Zo(e) {
	let t = this.resume(), n = this.stack[this.stack.length - 1];
	n.type, n.identifier = Mt(this.sliceSerialize(e)).toLowerCase(), n.label = t;
}
function Qo(e) {
	this.exit(e);
}
function $o() {
	return "[";
}
function es(e, t, n, r) {
	let i = n.createTracker(r), a = i.move("[^"), o = n.enter("footnoteReference"), s = n.enter("reference");
	return a += i.move(n.safe(n.associationId(e), {
		after: "]",
		before: a
	})), s(), o(), a += i.move("]"), a;
}
function ts() {
	return {
		enter: {
			gfmFootnoteCallString: Go,
			gfmFootnoteCall: Ko,
			gfmFootnoteDefinitionLabelString: qo,
			gfmFootnoteDefinition: Jo
		},
		exit: {
			gfmFootnoteCallString: Yo,
			gfmFootnoteCall: Xo,
			gfmFootnoteDefinitionLabelString: Zo,
			gfmFootnoteDefinition: Qo
		}
	};
}
function ns(e) {
	let t = !1;
	return e && e.firstLineBlank && (t = !0), {
		handlers: {
			footnoteDefinition: n,
			footnoteReference: es
		},
		unsafe: [{
			character: "[",
			inConstruct: [
				"label",
				"phrasing",
				"reference"
			]
		}]
	};
	function n(e, n, r, i) {
		let a = r.createTracker(i), o = a.move("[^"), s = r.enter("footnoteDefinition"), c = r.enter("label");
		return o += a.move(r.safe(r.associationId(e), {
			before: o,
			after: "]"
		})), c(), o += a.move("]:"), e.children && e.children.length > 0 && (a.shift(4), o += a.move((t ? "\n" : " ") + r.indentLines(r.containerFlow(e, a.current()), t ? is : rs))), s(), o;
	}
}
function rs(e, t, n) {
	return t === 0 ? e : is(e, t, n);
}
function is(e, t, n) {
	return (n ? "" : "    ") + e;
}
//#endregion
//#region node_modules/mdast-util-gfm-strikethrough/lib/index.js
var as = [
	"autolink",
	"destinationLiteral",
	"destinationRaw",
	"reference",
	"titleQuote",
	"titleApostrophe"
];
us.peek = ds;
function os() {
	return {
		canContainEols: ["delete"],
		enter: { strikethrough: cs },
		exit: { strikethrough: ls }
	};
}
function ss() {
	return {
		unsafe: [{
			character: "~",
			inConstruct: "phrasing",
			notInConstruct: as
		}],
		handlers: { delete: us }
	};
}
function cs(e) {
	this.enter({
		type: "delete",
		children: []
	}, e);
}
function ls(e) {
	this.exit(e);
}
function us(e, t, n, r) {
	let i = n.createTracker(r), a = n.enter("strikethrough"), o = i.move("~~");
	return o += n.containerPhrasing(e, {
		...i.current(),
		before: o,
		after: "~"
	}), o += i.move("~~"), a(), o;
}
function ds() {
	return "~";
}
//#endregion
//#region node_modules/markdown-table/index.js
function fs(e) {
	return e.length;
}
function ps(e, t) {
	let n = t || {}, r = (n.align || []).concat(), i = n.stringLength || fs, a = [], o = [], s = [], c = [], l = 0, u = -1;
	for (; ++u < e.length;) {
		let t = [], r = [], a = -1;
		for (e[u].length > l && (l = e[u].length); ++a < e[u].length;) {
			let o = ms(e[u][a]);
			if (n.alignDelimiters !== !1) {
				let e = i(o);
				r[a] = e, (c[a] === void 0 || e > c[a]) && (c[a] = e);
			}
			t.push(o);
		}
		o[u] = t, s[u] = r;
	}
	let d = -1;
	if (typeof r == "object" && "length" in r) for (; ++d < l;) a[d] = hs(r[d]);
	else {
		let e = hs(r);
		for (; ++d < l;) a[d] = e;
	}
	d = -1;
	let f = [], p = [];
	for (; ++d < l;) {
		let e = a[d], t = "", r = "";
		e === 99 ? (t = ":", r = ":") : e === 108 ? t = ":" : e === 114 && (r = ":");
		let i = n.alignDelimiters === !1 ? 1 : Math.max(1, c[d] - t.length - r.length), o = t + "-".repeat(i) + r;
		n.alignDelimiters !== !1 && (i = t.length + i + r.length, i > c[d] && (c[d] = i), p[d] = i), f[d] = o;
	}
	o.splice(1, 0, f), s.splice(1, 0, p), u = -1;
	let m = [];
	for (; ++u < o.length;) {
		let e = o[u], t = s[u];
		d = -1;
		let r = [];
		for (; ++d < l;) {
			let i = e[d] || "", o = "", s = "";
			if (n.alignDelimiters !== !1) {
				let e = c[d] - (t[d] || 0), n = a[d];
				n === 114 ? o = " ".repeat(e) : n === 99 ? e % 2 ? (o = " ".repeat(e / 2 + .5), s = " ".repeat(e / 2 - .5)) : (o = " ".repeat(e / 2), s = o) : s = " ".repeat(e);
			}
			n.delimiterStart !== !1 && !d && r.push("|"), n.padding !== !1 && !(n.alignDelimiters === !1 && i === "") && (n.delimiterStart !== !1 || d) && r.push(" "), n.alignDelimiters !== !1 && r.push(o), r.push(i), n.alignDelimiters !== !1 && r.push(s), n.padding !== !1 && r.push(" "), (n.delimiterEnd !== !1 || d !== l - 1) && r.push("|");
		}
		m.push(n.delimiterEnd === !1 ? r.join("").replace(/ +$/, "") : r.join(""));
	}
	return m.join("\n");
}
function ms(e) {
	return e == null ? "" : String(e);
}
function hs(e) {
	let t = typeof e == "string" ? e.codePointAt(0) : 0;
	return t === 67 || t === 99 ? 99 : t === 76 || t === 108 ? 108 : t === 82 || t === 114 ? 114 : 0;
}
//#endregion
//#region node_modules/mdast-util-to-markdown/lib/handle/blockquote.js
function gs(e, t, n, r) {
	let i = n.enter("blockquote"), a = n.createTracker(r);
	a.move("> "), a.shift(2);
	let o = n.indentLines(n.containerFlow(e, a.current()), _s);
	return i(), o;
}
function _s(e, t, n) {
	return ">" + (n ? "" : " ") + e;
}
//#endregion
//#region node_modules/mdast-util-to-markdown/lib/util/pattern-in-scope.js
function vs(e, t) {
	return ys(e, t.inConstruct, !0) && !ys(e, t.notInConstruct, !1);
}
function ys(e, t, n) {
	if (typeof t == "string" && (t = [t]), !t || t.length === 0) return n;
	let r = -1;
	for (; ++r < t.length;) if (e.includes(t[r])) return !0;
	return !1;
}
//#endregion
//#region node_modules/mdast-util-to-markdown/lib/handle/break.js
function bs(e, t, n, r) {
	let i = -1;
	for (; ++i < n.unsafe.length;) if (n.unsafe[i].character === "\n" && vs(n.stack, n.unsafe[i])) return /[ \t]/.test(r.before) ? "" : " ";
	return "\\\n";
}
//#endregion
//#region node_modules/longest-streak/index.js
function xs(e, t) {
	let n = String(e), r = n.indexOf(t), i = r, a = 0, o = 0;
	if (typeof t != "string") throw TypeError("Expected substring");
	for (; r !== -1;) r === i ? ++a > o && (o = a) : a = 1, i = r + t.length, r = n.indexOf(t, i);
	return o;
}
//#endregion
//#region node_modules/mdast-util-to-markdown/lib/util/format-code-as-indented.js
function Ss(e, t) {
	return !!(t.options.fences === !1 && e.value && !e.lang && /[^ \r\n]/.test(e.value) && !/^[\t ]*(?:[\r\n]|$)|(?:^|[\r\n])[\t ]*$/.test(e.value));
}
//#endregion
//#region node_modules/mdast-util-to-markdown/lib/util/check-fence.js
function Cs(e) {
	let t = e.options.fence || "`";
	if (t !== "`" && t !== "~") throw Error("Cannot serialize code with `" + t + "` for `options.fence`, expected `` ` `` or `~`");
	return t;
}
//#endregion
//#region node_modules/mdast-util-to-markdown/lib/handle/code.js
function ws(e, t, n, r) {
	let i = Cs(n), a = e.value || "", o = i === "`" ? "GraveAccent" : "Tilde";
	if (Ss(e, n)) {
		let e = n.enter("codeIndented"), t = n.indentLines(a, Ts);
		return e(), t;
	}
	let s = n.createTracker(r), c = i.repeat(Math.max(xs(a, i) + 1, 3)), l = n.enter("codeFenced"), u = s.move(c);
	if (e.lang) {
		let t = n.enter(`codeFencedLang${o}`);
		u += s.move(n.safe(e.lang, {
			before: u,
			after: " ",
			encode: ["`"],
			...s.current()
		})), t();
	}
	if (e.lang && e.meta) {
		let t = n.enter(`codeFencedMeta${o}`);
		u += s.move(" "), u += s.move(n.safe(e.meta, {
			before: u,
			after: "\n",
			encode: ["`"],
			...s.current()
		})), t();
	}
	return u += s.move("\n"), a && (u += s.move(a + "\n")), u += s.move(c), l(), u;
}
function Ts(e, t, n) {
	return (n ? "" : "    ") + e;
}
//#endregion
//#region node_modules/mdast-util-to-markdown/lib/util/check-quote.js
function Es(e) {
	let t = e.options.quote || "\"";
	if (t !== "\"" && t !== "'") throw Error("Cannot serialize title with `" + t + "` for `options.quote`, expected `\"`, or `'`");
	return t;
}
//#endregion
//#region node_modules/mdast-util-to-markdown/lib/handle/definition.js
function Ds(e, t, n, r) {
	let i = Es(n), a = i === "\"" ? "Quote" : "Apostrophe", o = n.enter("definition"), s = n.enter("label"), c = n.createTracker(r), l = c.move("[");
	return l += c.move(n.safe(n.associationId(e), {
		before: l,
		after: "]",
		...c.current()
	})), l += c.move("]: "), s(), !e.url || /[\0- \u007F]/.test(e.url) ? (s = n.enter("destinationLiteral"), l += c.move("<"), l += c.move(n.safe(e.url, {
		before: l,
		after: ">",
		...c.current()
	})), l += c.move(">")) : (s = n.enter("destinationRaw"), l += c.move(n.safe(e.url, {
		before: l,
		after: e.title ? " " : "\n",
		...c.current()
	}))), s(), e.title && (s = n.enter(`title${a}`), l += c.move(" " + i), l += c.move(n.safe(e.title, {
		before: l,
		after: i,
		...c.current()
	})), l += c.move(i), s()), o(), l;
}
//#endregion
//#region node_modules/mdast-util-to-markdown/lib/util/check-emphasis.js
function Os(e) {
	let t = e.options.emphasis || "*";
	if (t !== "*" && t !== "_") throw Error("Cannot serialize emphasis with `" + t + "` for `options.emphasis`, expected `*`, or `_`");
	return t;
}
//#endregion
//#region node_modules/mdast-util-to-markdown/lib/util/encode-character-reference.js
function ks(e) {
	return "&#x" + e.toString(16).toUpperCase() + ";";
}
//#endregion
//#region node_modules/mdast-util-to-markdown/lib/util/encode-info.js
function As(e, t, n) {
	let r = Xt(e), i = Xt(t);
	return r === void 0 ? i === void 0 ? n === "_" ? {
		inside: !0,
		outside: !0
	} : {
		inside: !1,
		outside: !1
	} : i === 1 ? {
		inside: !0,
		outside: !0
	} : {
		inside: !1,
		outside: !0
	} : r === 1 ? i === void 0 ? {
		inside: !1,
		outside: !1
	} : i === 1 ? {
		inside: !0,
		outside: !0
	} : {
		inside: !1,
		outside: !1
	} : i === void 0 ? {
		inside: !1,
		outside: !1
	} : i === 1 ? {
		inside: !0,
		outside: !1
	} : {
		inside: !1,
		outside: !1
	};
}
//#endregion
//#region node_modules/mdast-util-to-markdown/lib/handle/emphasis.js
js.peek = Ms;
function js(e, t, n, r) {
	let i = Os(n), a = n.enter("emphasis"), o = n.createTracker(r), s = o.move(i), c = o.move(n.containerPhrasing(e, {
		after: i,
		before: s,
		...o.current()
	})), l = c.charCodeAt(0), u = As(r.before.charCodeAt(r.before.length - 1), l, i);
	u.inside && (c = ks(l) + c.slice(1));
	let d = c.charCodeAt(c.length - 1), f = As(r.after.charCodeAt(0), d, i);
	f.inside && (c = c.slice(0, -1) + ks(d));
	let p = o.move(i);
	return a(), n.attentionEncodeSurroundingInfo = {
		after: f.outside,
		before: u.outside
	}, s + c + p;
}
function Ms(e, t, n) {
	return n.options.emphasis || "*";
}
//#endregion
//#region node_modules/mdast-util-to-markdown/lib/util/format-heading-as-setext.js
function Ns(e, t) {
	let n = !1;
	return xa(e, function(e) {
		if ("value" in e && /\r?\n|\r/.test(e.value) || e.type === "break") return n = !0, !1;
	}), !!((!e.depth || e.depth < 3) && yt(e) && (t.options.setext || n));
}
//#endregion
//#region node_modules/mdast-util-to-markdown/lib/handle/heading.js
function Ps(e, t, n, r) {
	let i = Math.max(Math.min(6, e.depth || 1), 1), a = n.createTracker(r);
	if (Ns(e, n)) {
		let t = n.enter("headingSetext"), r = n.enter("phrasing"), o = n.containerPhrasing(e, {
			...a.current(),
			before: "\n",
			after: "\n"
		});
		return r(), t(), o + "\n" + (i === 1 ? "=" : "-").repeat(o.length - (Math.max(o.lastIndexOf("\r"), o.lastIndexOf("\n")) + 1));
	}
	let o = "#".repeat(i), s = n.enter("headingAtx"), c = n.enter("phrasing");
	a.move(o + " ");
	let l = n.containerPhrasing(e, {
		before: "# ",
		after: "\n",
		...a.current()
	});
	return /^[\t ]/.test(l) && (l = ks(l.charCodeAt(0)) + l.slice(1)), l = l ? o + " " + l : o, n.options.closeAtx && (l += " " + o), c(), s(), l;
}
//#endregion
//#region node_modules/mdast-util-to-markdown/lib/handle/html.js
Fs.peek = Is;
function Fs(e) {
	return e.value || "";
}
function Is() {
	return "<";
}
//#endregion
//#region node_modules/mdast-util-to-markdown/lib/handle/image.js
Ls.peek = Rs;
function Ls(e, t, n, r) {
	let i = Es(n), a = i === "\"" ? "Quote" : "Apostrophe", o = n.enter("image"), s = n.enter("label"), c = n.createTracker(r), l = c.move("![");
	return l += c.move(n.safe(e.alt, {
		before: l,
		after: "]",
		...c.current()
	})), l += c.move("]("), s(), !e.url && e.title || /[\0- \u007F]/.test(e.url) ? (s = n.enter("destinationLiteral"), l += c.move("<"), l += c.move(n.safe(e.url, {
		before: l,
		after: ">",
		...c.current()
	})), l += c.move(">")) : (s = n.enter("destinationRaw"), l += c.move(n.safe(e.url, {
		before: l,
		after: e.title ? " " : ")",
		...c.current()
	}))), s(), e.title && (s = n.enter(`title${a}`), l += c.move(" " + i), l += c.move(n.safe(e.title, {
		before: l,
		after: i,
		...c.current()
	})), l += c.move(i), s()), l += c.move(")"), o(), l;
}
function Rs() {
	return "!";
}
//#endregion
//#region node_modules/mdast-util-to-markdown/lib/handle/image-reference.js
zs.peek = Bs;
function zs(e, t, n, r) {
	let i = e.referenceType, a = n.enter("imageReference"), o = n.enter("label"), s = n.createTracker(r), c = s.move("!["), l = n.safe(e.alt, {
		before: c,
		after: "]",
		...s.current()
	});
	c += s.move(l + "]["), o();
	let u = n.stack;
	n.stack = [], o = n.enter("reference");
	let d = n.safe(n.associationId(e), {
		before: c,
		after: "]",
		...s.current()
	});
	return o(), n.stack = u, a(), i === "full" || !l || l !== d ? c += s.move(d + "]") : i === "shortcut" ? c = c.slice(0, -1) : c += s.move("]"), c;
}
function Bs() {
	return "!";
}
//#endregion
//#region node_modules/mdast-util-to-markdown/lib/handle/inline-code.js
Vs.peek = Hs;
function Vs(e, t, n) {
	let r = e.value || "", i = "`", a = -1;
	for (; RegExp("(^|[^`])" + i + "([^`]|$)").test(r);) i += "`";
	for (/[^ \r\n]/.test(r) && (/^[ \r\n]/.test(r) && /[ \r\n]$/.test(r) || /^`|`$/.test(r)) && (r = " " + r + " "); ++a < n.unsafe.length;) {
		let e = n.unsafe[a], t = n.compilePattern(e), i;
		if (e.atBreak) for (; i = t.exec(r);) {
			let e = i.index;
			r.charCodeAt(e) === 10 && r.charCodeAt(e - 1) === 13 && e--, r = r.slice(0, e) + " " + r.slice(i.index + 1);
		}
	}
	return i + r + i;
}
function Hs() {
	return "`";
}
//#endregion
//#region node_modules/mdast-util-to-markdown/lib/util/format-link-as-autolink.js
function Us(e, t) {
	let n = yt(e);
	return !!(!t.options.resourceLink && e.url && !e.title && e.children && e.children.length === 1 && e.children[0].type === "text" && (n === e.url || "mailto:" + n === e.url) && /^[a-z][a-z+.-]+:/i.test(e.url) && !/[\0- <>\u007F]/.test(e.url));
}
//#endregion
//#region node_modules/mdast-util-to-markdown/lib/handle/link.js
Ws.peek = Gs;
function Ws(e, t, n, r) {
	let i = Es(n), a = i === "\"" ? "Quote" : "Apostrophe", o = n.createTracker(r), s, c;
	if (Us(e, n)) {
		let t = n.stack;
		n.stack = [], s = n.enter("autolink");
		let r = o.move("<");
		return r += o.move(n.containerPhrasing(e, {
			before: r,
			after: ">",
			...o.current()
		})), r += o.move(">"), s(), n.stack = t, r;
	}
	s = n.enter("link"), c = n.enter("label");
	let l = o.move("[");
	return l += o.move(n.containerPhrasing(e, {
		before: l,
		after: "](",
		...o.current()
	})), l += o.move("]("), c(), !e.url && e.title || /[\0- \u007F]/.test(e.url) ? (c = n.enter("destinationLiteral"), l += o.move("<"), l += o.move(n.safe(e.url, {
		before: l,
		after: ">",
		...o.current()
	})), l += o.move(">")) : (c = n.enter("destinationRaw"), l += o.move(n.safe(e.url, {
		before: l,
		after: e.title ? " " : ")",
		...o.current()
	}))), c(), e.title && (c = n.enter(`title${a}`), l += o.move(" " + i), l += o.move(n.safe(e.title, {
		before: l,
		after: i,
		...o.current()
	})), l += o.move(i), c()), l += o.move(")"), s(), l;
}
function Gs(e, t, n) {
	return Us(e, n) ? "<" : "[";
}
//#endregion
//#region node_modules/mdast-util-to-markdown/lib/handle/link-reference.js
Ks.peek = qs;
function Ks(e, t, n, r) {
	let i = e.referenceType, a = n.enter("linkReference"), o = n.enter("label"), s = n.createTracker(r), c = s.move("["), l = n.containerPhrasing(e, {
		before: c,
		after: "]",
		...s.current()
	});
	c += s.move(l + "]["), o();
	let u = n.stack;
	n.stack = [], o = n.enter("reference");
	let d = n.safe(n.associationId(e), {
		before: c,
		after: "]",
		...s.current()
	});
	return o(), n.stack = u, a(), i === "full" || !l || l !== d ? c += s.move(d + "]") : i === "shortcut" ? c = c.slice(0, -1) : c += s.move("]"), c;
}
function qs() {
	return "[";
}
//#endregion
//#region node_modules/mdast-util-to-markdown/lib/util/check-bullet.js
function Js(e) {
	let t = e.options.bullet || "*";
	if (t !== "*" && t !== "+" && t !== "-") throw Error("Cannot serialize items with `" + t + "` for `options.bullet`, expected `*`, `+`, or `-`");
	return t;
}
//#endregion
//#region node_modules/mdast-util-to-markdown/lib/util/check-bullet-other.js
function Ys(e) {
	let t = Js(e), n = e.options.bulletOther;
	if (!n) return t === "*" ? "-" : "*";
	if (n !== "*" && n !== "+" && n !== "-") throw Error("Cannot serialize items with `" + n + "` for `options.bulletOther`, expected `*`, `+`, or `-`");
	if (n === t) throw Error("Expected `bullet` (`" + t + "`) and `bulletOther` (`" + n + "`) to be different");
	return n;
}
//#endregion
//#region node_modules/mdast-util-to-markdown/lib/util/check-bullet-ordered.js
function Xs(e) {
	let t = e.options.bulletOrdered || ".";
	if (t !== "." && t !== ")") throw Error("Cannot serialize items with `" + t + "` for `options.bulletOrdered`, expected `.` or `)`");
	return t;
}
//#endregion
//#region node_modules/mdast-util-to-markdown/lib/util/check-rule.js
function Zs(e) {
	let t = e.options.rule || "*";
	if (t !== "*" && t !== "-" && t !== "_") throw Error("Cannot serialize rules with `" + t + "` for `options.rule`, expected `*`, `-`, or `_`");
	return t;
}
//#endregion
//#region node_modules/mdast-util-to-markdown/lib/handle/list.js
function Qs(e, t, n, r) {
	let i = n.enter("list"), a = n.bulletCurrent, o = e.ordered ? Xs(n) : Js(n), s = e.ordered ? o === "." ? ")" : "." : Ys(n), c = t && n.bulletLastUsed ? o === n.bulletLastUsed : !1;
	if (!e.ordered) {
		let t = e.children ? e.children[0] : void 0;
		if ((o === "*" || o === "-") && t && (!t.children || !t.children[0]) && n.stack[n.stack.length - 1] === "list" && n.stack[n.stack.length - 2] === "listItem" && n.stack[n.stack.length - 3] === "list" && n.stack[n.stack.length - 4] === "listItem" && n.indexStack[n.indexStack.length - 1] === 0 && n.indexStack[n.indexStack.length - 2] === 0 && n.indexStack[n.indexStack.length - 3] === 0 && (c = !0), Zs(n) === o && t) {
			let t = -1;
			for (; ++t < e.children.length;) {
				let n = e.children[t];
				if (n && n.type === "listItem" && n.children && n.children[0] && n.children[0].type === "thematicBreak") {
					c = !0;
					break;
				}
			}
		}
	}
	c && (o = s), n.bulletCurrent = o;
	let l = n.containerFlow(e, r);
	return n.bulletLastUsed = o, n.bulletCurrent = a, i(), l;
}
//#endregion
//#region node_modules/mdast-util-to-markdown/lib/util/check-list-item-indent.js
function $s(e) {
	let t = e.options.listItemIndent || "one";
	if (t !== "tab" && t !== "one" && t !== "mixed") throw Error("Cannot serialize items with `" + t + "` for `options.listItemIndent`, expected `tab`, `one`, or `mixed`");
	return t;
}
//#endregion
//#region node_modules/mdast-util-to-markdown/lib/handle/list-item.js
function ec(e, t, n, r) {
	let i = $s(n), a = n.bulletCurrent || Js(n);
	t && t.type === "list" && t.ordered && (a = (typeof t.start == "number" && t.start > -1 ? t.start : 1) + (n.options.incrementListMarker === !1 ? 0 : t.children.indexOf(e)) + a);
	let o = a.length + 1;
	(i === "tab" || i === "mixed" && (t && t.type === "list" && t.spread || e.spread)) && (o = Math.ceil(o / 4) * 4);
	let s = n.createTracker(r);
	s.move(a + " ".repeat(o - a.length)), s.shift(o);
	let c = n.enter("listItem"), l = n.indentLines(n.containerFlow(e, s.current()), u);
	return c(), l;
	function u(e, t, n) {
		return t ? (n ? "" : " ".repeat(o)) + e : (n ? a : a + " ".repeat(o - a.length)) + e;
	}
}
//#endregion
//#region node_modules/mdast-util-to-markdown/lib/handle/paragraph.js
function tc(e, t, n, r) {
	let i = n.enter("paragraph"), a = n.enter("phrasing"), o = n.containerPhrasing(e, r);
	return a(), i(), o;
}
//#endregion
//#region node_modules/mdast-util-phrasing/lib/index.js
var nc = ua([
	"break",
	"delete",
	"emphasis",
	"footnote",
	"footnoteReference",
	"image",
	"imageReference",
	"inlineCode",
	"inlineMath",
	"link",
	"linkReference",
	"mdxJsxTextElement",
	"mdxTextExpression",
	"strong",
	"text",
	"textDirective"
]);
//#endregion
//#region node_modules/mdast-util-to-markdown/lib/handle/root.js
function rc(e, t, n, r) {
	return (e.children.some(function(e) {
		return nc(e);
	}) ? n.containerPhrasing : n.containerFlow).call(n, e, r);
}
//#endregion
//#region node_modules/mdast-util-to-markdown/lib/util/check-strong.js
function ic(e) {
	let t = e.options.strong || "*";
	if (t !== "*" && t !== "_") throw Error("Cannot serialize strong with `" + t + "` for `options.strong`, expected `*`, or `_`");
	return t;
}
//#endregion
//#region node_modules/mdast-util-to-markdown/lib/handle/strong.js
ac.peek = oc;
function ac(e, t, n, r) {
	let i = ic(n), a = n.enter("strong"), o = n.createTracker(r), s = o.move(i + i), c = o.move(n.containerPhrasing(e, {
		after: i,
		before: s,
		...o.current()
	})), l = c.charCodeAt(0), u = As(r.before.charCodeAt(r.before.length - 1), l, i);
	u.inside && (c = ks(l) + c.slice(1));
	let d = c.charCodeAt(c.length - 1), f = As(r.after.charCodeAt(0), d, i);
	f.inside && (c = c.slice(0, -1) + ks(d));
	let p = o.move(i + i);
	return a(), n.attentionEncodeSurroundingInfo = {
		after: f.outside,
		before: u.outside
	}, s + c + p;
}
function oc(e, t, n) {
	return n.options.strong || "*";
}
//#endregion
//#region node_modules/mdast-util-to-markdown/lib/handle/text.js
function sc(e, t, n, r) {
	return n.safe(e.value, r);
}
//#endregion
//#region node_modules/mdast-util-to-markdown/lib/util/check-rule-repetition.js
function cc(e) {
	let t = e.options.ruleRepetition || 3;
	if (t < 3) throw Error("Cannot serialize rules with repetition `" + t + "` for `options.ruleRepetition`, expected `3` or more");
	return t;
}
//#endregion
//#region node_modules/mdast-util-to-markdown/lib/handle/thematic-break.js
function lc(e, t, n) {
	let r = (Zs(n) + (n.options.ruleSpaces ? " " : "")).repeat(cc(n));
	return n.options.ruleSpaces ? r.slice(0, -1) : r;
}
//#endregion
//#region node_modules/mdast-util-to-markdown/lib/handle/index.js
var uc = {
	blockquote: gs,
	break: bs,
	code: ws,
	definition: Ds,
	emphasis: js,
	hardBreak: bs,
	heading: Ps,
	html: Fs,
	image: Ls,
	imageReference: zs,
	inlineCode: Vs,
	link: Ws,
	linkReference: Ks,
	list: Qs,
	listItem: ec,
	paragraph: tc,
	root: rc,
	strong: ac,
	text: sc,
	thematicBreak: lc
};
//#endregion
//#region node_modules/mdast-util-gfm-table/lib/index.js
function dc() {
	return {
		enter: {
			table: fc,
			tableData: gc,
			tableHeader: gc,
			tableRow: mc
		},
		exit: {
			codeText: _c,
			table: pc,
			tableData: hc,
			tableHeader: hc,
			tableRow: hc
		}
	};
}
function fc(e) {
	let t = e._align;
	this.enter({
		type: "table",
		align: t.map(function(e) {
			return e === "none" ? null : e;
		}),
		children: []
	}, e), this.data.inTable = !0;
}
function pc(e) {
	this.exit(e), this.data.inTable = void 0;
}
function mc(e) {
	this.enter({
		type: "tableRow",
		children: []
	}, e);
}
function hc(e) {
	this.exit(e);
}
function gc(e) {
	this.enter({
		type: "tableCell",
		children: []
	}, e);
}
function _c(e) {
	let t = this.resume();
	this.data.inTable && (t = t.replace(/\\([\\|])/g, vc));
	let n = this.stack[this.stack.length - 1];
	n.type, n.value = t, this.exit(e);
}
function vc(e, t) {
	return t === "|" ? t : e;
}
function yc(e) {
	let t = e || {}, n = t.tableCellPadding, r = t.tablePipeAlign, i = t.stringLength, a = n ? " " : "|";
	return {
		unsafe: [
			{
				character: "\r",
				inConstruct: "tableCell"
			},
			{
				character: "\n",
				inConstruct: "tableCell"
			},
			{
				atBreak: !0,
				character: "|",
				after: "[	 :-]"
			},
			{
				character: "|",
				inConstruct: "tableCell"
			},
			{
				atBreak: !0,
				character: ":",
				after: "-"
			},
			{
				atBreak: !0,
				character: "-",
				after: "[:|-]"
			}
		],
		handlers: {
			inlineCode: f,
			table: o,
			tableCell: c,
			tableRow: s
		}
	};
	function o(e, t, n, r) {
		return l(u(e, n, r), e.align);
	}
	function s(e, t, n, r) {
		let i = l([d(e, n, r)]);
		return i.slice(0, i.indexOf("\n"));
	}
	function c(e, t, n, r) {
		let i = n.enter("tableCell"), o = n.enter("phrasing"), s = n.containerPhrasing(e, {
			...r,
			before: a,
			after: a
		});
		return o(), i(), s;
	}
	function l(e, t) {
		return ps(e, {
			align: t,
			alignDelimiters: r,
			padding: n,
			stringLength: i
		});
	}
	function u(e, t, n) {
		let r = e.children, i = -1, a = [], o = t.enter("table");
		for (; ++i < r.length;) a[i] = d(r[i], t, n);
		return o(), a;
	}
	function d(e, t, n) {
		let r = e.children, i = -1, a = [], o = t.enter("tableRow");
		for (; ++i < r.length;) a[i] = c(r[i], e, t, n);
		return o(), a;
	}
	function f(e, t, n) {
		let r = uc.inlineCode(e, t, n);
		return n.stack.includes("tableCell") && (r = r.replace(/\|/g, "\\$&")), r;
	}
}
//#endregion
//#region node_modules/mdast-util-gfm-task-list-item/lib/index.js
function bc() {
	return { exit: {
		taskListCheckValueChecked: Sc,
		taskListCheckValueUnchecked: Sc,
		paragraph: Cc
	} };
}
function xc() {
	return {
		unsafe: [{
			atBreak: !0,
			character: "-",
			after: "[:|-]"
		}],
		handlers: { listItem: wc }
	};
}
function Sc(e) {
	let t = this.stack[this.stack.length - 2];
	t.type, t.checked = e.type === "taskListCheckValueChecked";
}
function Cc(e) {
	let t = this.stack[this.stack.length - 2];
	if (t && t.type === "listItem" && typeof t.checked == "boolean") {
		let e = this.stack[this.stack.length - 1];
		e.type;
		let n = e.children[0];
		if (n && n.type === "text") {
			let r = t.children, i = -1, a;
			for (; ++i < r.length;) {
				let e = r[i];
				if (e.type === "paragraph") {
					a = e;
					break;
				}
			}
			a === e && (n.value = n.value.slice(1), n.value.length === 0 ? e.children.shift() : e.position && n.position && typeof n.position.start.offset == "number" && (n.position.start.column++, n.position.start.offset++, e.position.start = Object.assign({}, n.position.start)));
		}
	}
	this.exit(e);
}
function wc(e, t, n, r) {
	let i = e.children[0], a = typeof e.checked == "boolean" && i && i.type === "paragraph", o = "[" + (e.checked ? "x" : " ") + "] ", s = n.createTracker(r);
	a && s.move(o);
	let c = uc.listItem(e, t, n, {
		...r,
		...s.current()
	});
	return a && (c = c.replace(/^(?:[*+-]|\d+\.)([\r\n]| {1,3})/, l)), c;
	function l(e) {
		return e + o;
	}
}
//#endregion
//#region node_modules/mdast-util-gfm/lib/index.js
function Tc() {
	return [
		jo(),
		ts(),
		os(),
		dc(),
		bc()
	];
}
function Ec(e) {
	return { extensions: [
		Mo(),
		ns(e),
		ss(),
		yc(e),
		xc()
	] };
}
//#endregion
//#region node_modules/micromark-extension-gfm-autolink-literal/lib/syntax.js
var Dc = {
	tokenize: Bc,
	partial: !0
}, W = {
	tokenize: Vc,
	partial: !0
}, Oc = {
	tokenize: Hc,
	partial: !0
}, kc = {
	tokenize: Uc,
	partial: !0
}, Ac = {
	tokenize: Wc,
	partial: !0
}, jc = {
	name: "wwwAutolink",
	tokenize: Rc,
	previous: Gc
}, Mc = {
	name: "protocolAutolink",
	tokenize: zc,
	previous: Kc
}, Nc = {
	name: "emailAutolink",
	tokenize: Lc,
	previous: qc
}, Pc = {};
function Fc() {
	return { text: Pc };
}
for (var Ic = 48; Ic < 123;) Pc[Ic] = Nc, Ic++, Ic === 58 ? Ic = 65 : Ic === 91 && (Ic = 97);
Pc[43] = Nc, Pc[45] = Nc, Pc[46] = Nc, Pc[95] = Nc, Pc[72] = [Nc, Mc], Pc[104] = [Nc, Mc], Pc[87] = [Nc, jc], Pc[119] = [Nc, jc];
function Lc(e, t, n) {
	let r = this, i, a;
	return o;
	function o(t) {
		return !Jc(t) || !qc.call(r, r.previous) || Yc(r.events) ? n(t) : (e.enter("literalAutolink"), e.enter("literalAutolinkEmail"), s(t));
	}
	function s(t) {
		return Jc(t) ? (e.consume(t), s) : t === 64 ? (e.consume(t), c) : n(t);
	}
	function c(t) {
		return t === 46 ? e.check(Ac, u, l)(t) : t === 45 || t === 95 || Pt(t) ? (a = !0, e.consume(t), c) : u(t);
	}
	function l(t) {
		return e.consume(t), i = !0, c;
	}
	function u(o) {
		return a && i && Nt(r.previous) ? (e.exit("literalAutolinkEmail"), e.exit("literalAutolink"), t(o)) : n(o);
	}
}
function Rc(e, t, n) {
	let r = this;
	return i;
	function i(t) {
		return t !== 87 && t !== 119 || !Gc.call(r, r.previous) || Yc(r.events) ? n(t) : (e.enter("literalAutolink"), e.enter("literalAutolinkWww"), e.check(Dc, e.attempt(W, e.attempt(Oc, a), n), n)(t));
	}
	function a(n) {
		return e.exit("literalAutolinkWww"), e.exit("literalAutolink"), t(n);
	}
}
function zc(e, t, n) {
	let r = this, i = "", a = !1;
	return o;
	function o(t) {
		return (t === 72 || t === 104) && Kc.call(r, r.previous) && !Yc(r.events) ? (e.enter("literalAutolink"), e.enter("literalAutolinkHttp"), i += String.fromCodePoint(t), e.consume(t), s) : n(t);
	}
	function s(t) {
		if (Nt(t) && i.length < 5) return i += String.fromCodePoint(t), e.consume(t), s;
		if (t === 58) {
			let n = i.toLowerCase();
			if (n === "http" || n === "https") return e.consume(t), c;
		}
		return n(t);
	}
	function c(t) {
		return t === 47 ? (e.consume(t), a ? l : (a = !0, c)) : n(t);
	}
	function l(t) {
		return t === null || It(t) || F(t) || Vt(t) || Bt(t) ? n(t) : e.attempt(W, e.attempt(Oc, u), n)(t);
	}
	function u(n) {
		return e.exit("literalAutolinkHttp"), e.exit("literalAutolink"), t(n);
	}
}
function Bc(e, t, n) {
	let r = 0;
	return i;
	function i(t) {
		return (t === 87 || t === 119) && r < 3 ? (r++, e.consume(t), i) : t === 46 && r === 3 ? (e.consume(t), a) : n(t);
	}
	function a(e) {
		return e === null ? n(e) : t(e);
	}
}
function Vc(e, t, n) {
	let r, i, a;
	return o;
	function o(t) {
		return t === 46 || t === 95 ? e.check(kc, c, s)(t) : t === null || F(t) || Vt(t) || t !== 45 && Bt(t) ? c(t) : (a = !0, e.consume(t), o);
	}
	function s(t) {
		return t === 95 ? r = !0 : (i = r, r = void 0), e.consume(t), o;
	}
	function c(e) {
		return i || r || !a ? n(e) : t(e);
	}
}
function Hc(e, t) {
	let n = 0, r = 0;
	return i;
	function i(o) {
		return o === 40 ? (n++, e.consume(o), i) : o === 41 && r < n ? a(o) : o === 33 || o === 34 || o === 38 || o === 39 || o === 41 || o === 42 || o === 44 || o === 46 || o === 58 || o === 59 || o === 60 || o === 63 || o === 93 || o === 95 || o === 126 ? e.check(kc, t, a)(o) : o === null || F(o) || Vt(o) ? t(o) : (e.consume(o), i);
	}
	function a(t) {
		return t === 41 && r++, e.consume(t), i;
	}
}
function Uc(e, t, n) {
	return r;
	function r(o) {
		return o === 33 || o === 34 || o === 39 || o === 41 || o === 42 || o === 44 || o === 46 || o === 58 || o === 59 || o === 63 || o === 95 || o === 126 ? (e.consume(o), r) : o === 38 ? (e.consume(o), a) : o === 93 ? (e.consume(o), i) : o === 60 || o === null || F(o) || Vt(o) ? t(o) : n(o);
	}
	function i(e) {
		return e === null || e === 40 || e === 91 || F(e) || Vt(e) ? t(e) : r(e);
	}
	function a(e) {
		return Nt(e) ? o(e) : n(e);
	}
	function o(t) {
		return t === 59 ? (e.consume(t), r) : Nt(t) ? (e.consume(t), o) : n(t);
	}
}
function Wc(e, t, n) {
	return r;
	function r(t) {
		return e.consume(t), i;
	}
	function i(e) {
		return Pt(e) ? n(e) : t(e);
	}
}
function Gc(e) {
	return e === null || e === 40 || e === 42 || e === 95 || e === 91 || e === 93 || e === 126 || F(e);
}
function Kc(e) {
	return !Nt(e);
}
function qc(e) {
	return !(e === 47 || Jc(e));
}
function Jc(e) {
	return e === 43 || e === 45 || e === 46 || e === 95 || Pt(e);
}
function Yc(e) {
	let t = e.length, n = !1;
	for (; t--;) {
		let r = e[t][1];
		if ((r.type === "labelLink" || r.type === "labelImage") && !r._balanced) {
			n = !0;
			break;
		}
		if (r._gfmAutolinkLiteralWalkedInto) {
			n = !1;
			break;
		}
	}
	return e.length > 0 && !n && (e[e.length - 1][1]._gfmAutolinkLiteralWalkedInto = !0), n;
}
//#endregion
//#region node_modules/micromark-extension-gfm-footnote/lib/syntax.js
var Xc = {
	tokenize: rl,
	partial: !0
};
function Zc() {
	return {
		document: { 91: {
			name: "gfmFootnoteDefinition",
			tokenize: el,
			continuation: { tokenize: tl },
			exit: nl
		} },
		text: {
			91: {
				name: "gfmFootnoteCall",
				tokenize: $c
			},
			93: {
				name: "gfmPotentialFootnoteCall",
				add: "after",
				tokenize: G,
				resolveTo: Qc
			}
		}
	};
}
function G(e, t, n) {
	let r = this, i = r.events.length, a = r.parser.gfmFootnotes || (r.parser.gfmFootnotes = []), o;
	for (; i--;) {
		let e = r.events[i][1];
		if (e.type === "labelImage") {
			o = e;
			break;
		}
		if (e.type === "gfmFootnoteCall" || e.type === "labelLink" || e.type === "label" || e.type === "image" || e.type === "link") break;
	}
	return s;
	function s(i) {
		if (!o || !o._balanced) return n(i);
		let s = Mt(r.sliceSerialize({
			start: o.end,
			end: r.now()
		}));
		return s.codePointAt(0) !== 94 || !a.includes(s.slice(1)) ? n(i) : (e.enter("gfmFootnoteCallLabelMarker"), e.consume(i), e.exit("gfmFootnoteCallLabelMarker"), t(i));
	}
}
function Qc(e, t) {
	let n = e.length;
	for (; n--;) if (e[n][1].type === "labelImage" && e[n][0] === "enter") {
		e[n][1];
		break;
	}
	e[n + 1][1].type = "data", e[n + 3][1].type = "gfmFootnoteCallLabelMarker";
	let r = {
		type: "gfmFootnoteCall",
		start: Object.assign({}, e[n + 3][1].start),
		end: Object.assign({}, e[e.length - 1][1].end)
	}, i = {
		type: "gfmFootnoteCallMarker",
		start: Object.assign({}, e[n + 3][1].end),
		end: Object.assign({}, e[n + 3][1].end)
	};
	i.end.column++, i.end.offset++, i.end._bufferIndex++;
	let a = {
		type: "gfmFootnoteCallString",
		start: Object.assign({}, i.end),
		end: Object.assign({}, e[e.length - 1][1].start)
	}, o = {
		type: "chunkString",
		contentType: "string",
		start: Object.assign({}, a.start),
		end: Object.assign({}, a.end)
	}, s = [
		e[n + 1],
		e[n + 2],
		[
			"enter",
			r,
			t
		],
		e[n + 3],
		e[n + 4],
		[
			"enter",
			i,
			t
		],
		[
			"exit",
			i,
			t
		],
		[
			"enter",
			a,
			t
		],
		[
			"enter",
			o,
			t
		],
		[
			"exit",
			o,
			t
		],
		[
			"exit",
			a,
			t
		],
		e[e.length - 2],
		e[e.length - 1],
		[
			"exit",
			r,
			t
		]
	];
	return e.splice(n, e.length - n + 1, ...s), e;
}
function $c(e, t, n) {
	let r = this, i = r.parser.gfmFootnotes || (r.parser.gfmFootnotes = []), a = 0, o;
	return s;
	function s(t) {
		return e.enter("gfmFootnoteCall"), e.enter("gfmFootnoteCallLabelMarker"), e.consume(t), e.exit("gfmFootnoteCallLabelMarker"), c;
	}
	function c(t) {
		return t === 94 ? (e.enter("gfmFootnoteCallMarker"), e.consume(t), e.exit("gfmFootnoteCallMarker"), e.enter("gfmFootnoteCallString"), e.enter("chunkString").contentType = "string", l) : n(t);
	}
	function l(s) {
		if (a > 999 || s === 93 && !o || s === null || s === 91 || F(s)) return n(s);
		if (s === 93) {
			e.exit("chunkString");
			let a = e.exit("gfmFootnoteCallString");
			return i.includes(Mt(r.sliceSerialize(a))) ? (e.enter("gfmFootnoteCallLabelMarker"), e.consume(s), e.exit("gfmFootnoteCallLabelMarker"), e.exit("gfmFootnoteCall"), t) : n(s);
		}
		return F(s) || (o = !0), a++, e.consume(s), s === 92 ? u : l;
	}
	function u(t) {
		return t === 91 || t === 92 || t === 93 ? (e.consume(t), a++, l) : l(t);
	}
}
function el(e, t, n) {
	let r = this, i = r.parser.gfmFootnotes || (r.parser.gfmFootnotes = []), a, o = 0, s;
	return c;
	function c(t) {
		return e.enter("gfmFootnoteDefinition")._container = !0, e.enter("gfmFootnoteDefinitionLabel"), e.enter("gfmFootnoteDefinitionLabelMarker"), e.consume(t), e.exit("gfmFootnoteDefinitionLabelMarker"), l;
	}
	function l(t) {
		return t === 94 ? (e.enter("gfmFootnoteDefinitionMarker"), e.consume(t), e.exit("gfmFootnoteDefinitionMarker"), e.enter("gfmFootnoteDefinitionLabelString"), e.enter("chunkString").contentType = "string", u) : n(t);
	}
	function u(t) {
		if (o > 999 || t === 93 && !s || t === null || t === 91 || F(t)) return n(t);
		if (t === 93) {
			e.exit("chunkString");
			let n = e.exit("gfmFootnoteDefinitionLabelString");
			return a = Mt(r.sliceSerialize(n)), e.enter("gfmFootnoteDefinitionLabelMarker"), e.consume(t), e.exit("gfmFootnoteDefinitionLabelMarker"), e.exit("gfmFootnoteDefinitionLabel"), f;
		}
		return F(t) || (s = !0), o++, e.consume(t), t === 92 ? d : u;
	}
	function d(t) {
		return t === 91 || t === 92 || t === 93 ? (e.consume(t), o++, u) : u(t);
	}
	function f(t) {
		return t === 58 ? (e.enter("definitionMarker"), e.consume(t), e.exit("definitionMarker"), i.includes(a) || i.push(a), L(e, p, "gfmFootnoteDefinitionWhitespace")) : n(t);
	}
	function p(e) {
		return t(e);
	}
}
function tl(e, t, n) {
	return e.check(an, t, e.attempt(Xc, t, n));
}
function nl(e) {
	e.exit("gfmFootnoteDefinition");
}
function rl(e, t, n) {
	let r = this;
	return L(e, i, "gfmFootnoteDefinitionIndent", 5);
	function i(e) {
		let i = r.events[r.events.length - 1];
		return i && i[1].type === "gfmFootnoteDefinitionIndent" && i[2].sliceSerialize(i[1], !0).length === 4 ? t(e) : n(e);
	}
}
//#endregion
//#region node_modules/micromark-extension-gfm-strikethrough/lib/syntax.js
function il(e) {
	let t = (e || {}).singleTilde, n = {
		name: "strikethrough",
		tokenize: i,
		resolveAll: r
	};
	return t ??= !0, {
		text: { 126: n },
		insideSpan: { null: [n] },
		attentionMarkers: { null: [126] }
	};
	function r(e, t) {
		let n = -1;
		for (; ++n < e.length;) if (e[n][0] === "enter" && e[n][1].type === "strikethroughSequenceTemporary" && e[n][1]._close) {
			let r = n;
			for (; r--;) if (e[r][0] === "exit" && e[r][1].type === "strikethroughSequenceTemporary" && e[r][1]._open && e[n][1].end.offset - e[n][1].start.offset === e[r][1].end.offset - e[r][1].start.offset) {
				e[n][1].type = "strikethroughSequence", e[r][1].type = "strikethroughSequence";
				let i = {
					type: "strikethrough",
					start: Object.assign({}, e[r][1].start),
					end: Object.assign({}, e[n][1].end)
				}, a = {
					type: "strikethroughText",
					start: Object.assign({}, e[r][1].end),
					end: Object.assign({}, e[n][1].start)
				}, o = [
					[
						"enter",
						i,
						t
					],
					[
						"enter",
						e[r][1],
						t
					],
					[
						"exit",
						e[r][1],
						t
					],
					[
						"enter",
						a,
						t
					]
				], s = t.parser.constructs.insideSpan.null;
				s && Tt(o, o.length, 0, Zt(s, e.slice(r + 1, n), t)), Tt(o, o.length, 0, [
					[
						"exit",
						a,
						t
					],
					[
						"enter",
						e[n][1],
						t
					],
					[
						"exit",
						e[n][1],
						t
					],
					[
						"exit",
						i,
						t
					]
				]), Tt(e, r - 1, n - r + 3, o), n = r + o.length - 2;
				break;
			}
		}
		for (n = -1; ++n < e.length;) e[n][1].type === "strikethroughSequenceTemporary" && (e[n][1].type = "data");
		return e;
	}
	function i(e, n, r) {
		let i = this.previous, a = this.events, o = 0;
		return s;
		function s(t) {
			return i === 126 && a[a.length - 1][1].type !== "characterEscape" ? r(t) : (e.enter("strikethroughSequenceTemporary"), c(t));
		}
		function c(a) {
			let s = Xt(i);
			if (a === 126) return o > 1 ? r(a) : (e.consume(a), o++, c);
			if (o < 2 && !t) return r(a);
			let l = e.exit("strikethroughSequenceTemporary"), u = Xt(a);
			return l._open = !u || u === 2 && !!s, l._close = !s || s === 2 && !!u, n(a);
		}
	}
}
//#endregion
//#region node_modules/micromark-extension-gfm-table/lib/edit-map.js
var al = class {
	constructor() {
		this.map = [];
	}
	add(e, t, n) {
		ol(this, e, t, n);
	}
	consume(e) {
		/* c8 ignore next 3 -- `resolve` is never called without tables, so without edits. */
		if (this.map.sort(function(e, t) {
			return e[0] - t[0];
		}), this.map.length === 0) return;
		let t = this.map.length, n = [];
		for (; t > 0;) --t, n.push(e.slice(this.map[t][0] + this.map[t][1]), this.map[t][2]), e.length = this.map[t][0];
		n.push(e.slice()), e.length = 0;
		let r = n.pop();
		for (; r;) {
			for (let t of r) e.push(t);
			r = n.pop();
		}
		this.map.length = 0;
	}
};
function ol(e, t, n, r) {
	let i = 0;
	if (!(n === 0 && r.length === 0)) {
		for (; i < e.map.length;) {
			if (e.map[i][0] === t) {
				e.map[i][1] += n, e.map[i][2].push(...r);
				return;
			}
			i += 1;
		}
		e.map.push([
			t,
			n,
			r
		]);
	}
}
//#endregion
//#region node_modules/micromark-extension-gfm-table/lib/infer.js
function sl(e, t) {
	let n = !1, r = [];
	for (; t < e.length;) {
		let i = e[t];
		if (n) {
			if (i[0] === "enter") i[1].type === "tableContent" && r.push(e[t + 1][1].type === "tableDelimiterMarker" ? "left" : "none");
			else if (i[1].type === "tableContent") {
				if (e[t - 1][1].type === "tableDelimiterMarker") {
					let e = r.length - 1;
					r[e] = r[e] === "left" ? "center" : "right";
				}
			} else if (i[1].type === "tableDelimiterRow") break;
		} else i[0] === "enter" && i[1].type === "tableDelimiterRow" && (n = !0);
		t += 1;
	}
	return r;
}
//#endregion
//#region node_modules/micromark-extension-gfm-table/lib/syntax.js
function cl() {
	return { flow: { null: {
		name: "table",
		tokenize: ll,
		resolveAll: ul
	} } };
}
function ll(e, t, n) {
	let r = this, i = 0, a = 0, o;
	return s;
	function s(e) {
		let t = r.events.length - 1;
		for (; t > -1;) {
			let e = r.events[t][1].type;
			if (e === "lineEnding" || e === "linePrefix") t--;
			else break;
		}
		let i = t > -1 ? r.events[t][1].type : null, a = i === "tableHead" || i === "tableRow" ? x : c;
		return a === x && r.parser.lazy[r.now().line] ? n(e) : a(e);
	}
	function c(t) {
		return e.enter("tableHead"), e.enter("tableRow"), l(t);
	}
	function l(e) {
		return e === 124 ? u(e) : (o = !0, a += 1, u(e));
	}
	function u(t) {
		return t === null ? n(t) : P(t) ? a > 1 ? (a = 0, r.interrupt = !0, e.exit("tableRow"), e.enter("lineEnding"), e.consume(t), e.exit("lineEnding"), p) : n(t) : I(t) ? L(e, u, "whitespace")(t) : (a += 1, o && (o = !1, i += 1), t === 124 ? (e.enter("tableCellDivider"), e.consume(t), e.exit("tableCellDivider"), o = !0, u) : (e.enter("data"), d(t)));
	}
	function d(t) {
		return t === null || t === 124 || F(t) ? (e.exit("data"), u(t)) : (e.consume(t), t === 92 ? f : d);
	}
	function f(t) {
		return t === 92 || t === 124 ? (e.consume(t), d) : d(t);
	}
	function p(t) {
		return r.interrupt = !1, r.parser.lazy[r.now().line] ? n(t) : (e.enter("tableDelimiterRow"), o = !1, I(t) ? L(e, m, "linePrefix", r.parser.constructs.disable.null.includes("codeIndented") ? void 0 : 4)(t) : m(t));
	}
	function m(t) {
		return t === 45 || t === 58 ? g(t) : t === 124 ? (o = !0, e.enter("tableCellDivider"), e.consume(t), e.exit("tableCellDivider"), h) : ee(t);
	}
	function h(t) {
		return I(t) ? L(e, g, "whitespace")(t) : g(t);
	}
	function g(t) {
		return t === 58 ? (a += 1, o = !0, e.enter("tableDelimiterMarker"), e.consume(t), e.exit("tableDelimiterMarker"), _) : t === 45 ? (a += 1, _(t)) : t === null || P(t) ? b(t) : ee(t);
	}
	function _(t) {
		return t === 45 ? (e.enter("tableDelimiterFiller"), v(t)) : ee(t);
	}
	function v(t) {
		return t === 45 ? (e.consume(t), v) : t === 58 ? (o = !0, e.exit("tableDelimiterFiller"), e.enter("tableDelimiterMarker"), e.consume(t), e.exit("tableDelimiterMarker"), y) : (e.exit("tableDelimiterFiller"), y(t));
	}
	function y(t) {
		return I(t) ? L(e, b, "whitespace")(t) : b(t);
	}
	function b(n) {
		return n === 124 ? m(n) : n === null || P(n) ? !o || i !== a ? ee(n) : (e.exit("tableDelimiterRow"), e.exit("tableHead"), t(n)) : ee(n);
	}
	function ee(e) {
		return n(e);
	}
	function x(t) {
		return e.enter("tableRow"), S(t);
	}
	function S(n) {
		return n === 124 ? (e.enter("tableCellDivider"), e.consume(n), e.exit("tableCellDivider"), S) : n === null || P(n) ? (e.exit("tableRow"), t(n)) : I(n) ? L(e, S, "whitespace")(n) : (e.enter("data"), te(n));
	}
	function te(t) {
		return t === null || t === 124 || F(t) ? (e.exit("data"), S(t)) : (e.consume(t), t === 92 ? C : te);
	}
	function C(t) {
		return t === 92 || t === 124 ? (e.consume(t), te) : te(t);
	}
}
function ul(e, t) {
	let n = -1, r = !0, i = 0, a = [
		0,
		0,
		0,
		0
	], o = [
		0,
		0,
		0,
		0
	], s = !1, c = 0, l, u, d, f = new al();
	for (; ++n < e.length;) {
		let p = e[n], m = p[1];
		p[0] === "enter" ? m.type === "tableHead" ? (s = !1, c !== 0 && (fl(f, t, c, l, u), u = void 0, c = 0), l = {
			type: "table",
			start: Object.assign({}, m.start),
			end: Object.assign({}, m.end)
		}, f.add(n, 0, [[
			"enter",
			l,
			t
		]])) : m.type === "tableRow" || m.type === "tableDelimiterRow" ? (r = !0, d = void 0, a = [
			0,
			0,
			0,
			0
		], o = [
			0,
			n + 1,
			0,
			0
		], s && (s = !1, u = {
			type: "tableBody",
			start: Object.assign({}, m.start),
			end: Object.assign({}, m.end)
		}, f.add(n, 0, [[
			"enter",
			u,
			t
		]])), i = m.type === "tableDelimiterRow" ? 2 : u ? 3 : 1) : i && (m.type === "data" || m.type === "tableDelimiterMarker" || m.type === "tableDelimiterFiller") ? (r = !1, o[2] === 0 && (a[1] !== 0 && (o[0] = o[1], d = dl(f, t, a, i, void 0, d), a = [
			0,
			0,
			0,
			0
		]), o[2] = n)) : m.type === "tableCellDivider" && (r ? r = !1 : (a[1] !== 0 && (o[0] = o[1], d = dl(f, t, a, i, void 0, d)), a = o, o = [
			a[1],
			n,
			0,
			0
		])) : m.type === "tableHead" ? (s = !0, c = n) : m.type === "tableRow" || m.type === "tableDelimiterRow" ? (c = n, a[1] === 0 ? o[1] !== 0 && (d = dl(f, t, o, i, n, d)) : (o[0] = o[1], d = dl(f, t, a, i, n, d)), i = 0) : i && (m.type === "data" || m.type === "tableDelimiterMarker" || m.type === "tableDelimiterFiller") && (o[3] = n);
	}
	for (c !== 0 && fl(f, t, c, l, u), f.consume(t.events), n = -1; ++n < t.events.length;) {
		let e = t.events[n];
		e[0] === "enter" && e[1].type === "table" && (e[1]._align = sl(t.events, n));
	}
	return e;
}
function dl(e, t, n, r, i, a) {
	let o = r === 1 ? "tableHeader" : r === 2 ? "tableDelimiter" : "tableData";
	n[0] !== 0 && (a.end = Object.assign({}, pl(t.events, n[0])), e.add(n[0], 0, [[
		"exit",
		a,
		t
	]]));
	let s = pl(t.events, n[1]);
	if (a = {
		type: o,
		start: Object.assign({}, s),
		end: Object.assign({}, s)
	}, e.add(n[1], 0, [[
		"enter",
		a,
		t
	]]), n[2] !== 0) {
		let i = pl(t.events, n[2]), a = pl(t.events, n[3]), o = {
			type: "tableContent",
			start: Object.assign({}, i),
			end: Object.assign({}, a)
		};
		if (e.add(n[2], 0, [[
			"enter",
			o,
			t
		]]), r !== 2) {
			let r = t.events[n[2]], i = t.events[n[3]];
			if (r[1].end = Object.assign({}, i[1].end), r[1].type = "chunkText", r[1].contentType = "text", n[3] > n[2] + 1) {
				let t = n[2] + 1, r = n[3] - n[2] - 1;
				e.add(t, r, []);
			}
		}
		e.add(n[3] + 1, 0, [[
			"exit",
			o,
			t
		]]);
	}
	return i !== void 0 && (a.end = Object.assign({}, pl(t.events, i)), e.add(i, 0, [[
		"exit",
		a,
		t
	]]), a = void 0), a;
}
function fl(e, t, n, r, i) {
	let a = [], o = pl(t.events, n);
	i && (i.end = Object.assign({}, o), a.push([
		"exit",
		i,
		t
	])), r.end = Object.assign({}, o), a.push([
		"exit",
		r,
		t
	]), e.add(n + 1, 0, a);
}
function pl(e, t) {
	let n = e[t], r = n[0] === "enter" ? "start" : "end";
	return n[1][r];
}
//#endregion
//#region node_modules/micromark-extension-gfm-task-list-item/lib/syntax.js
var ml = {
	name: "tasklistCheck",
	tokenize: gl
};
function hl() {
	return { text: { 91: ml } };
}
function gl(e, t, n) {
	let r = this;
	return i;
	function i(t) {
		return r.previous !== null || !r._gfmTasklistFirstContentOfListItem ? n(t) : (e.enter("taskListCheck"), e.enter("taskListCheckMarker"), e.consume(t), e.exit("taskListCheckMarker"), a);
	}
	function a(t) {
		return F(t) ? (e.enter("taskListCheckValueUnchecked"), e.consume(t), e.exit("taskListCheckValueUnchecked"), o) : t === 88 || t === 120 ? (e.enter("taskListCheckValueChecked"), e.consume(t), e.exit("taskListCheckValueChecked"), o) : n(t);
	}
	function o(t) {
		return t === 93 ? (e.enter("taskListCheckMarker"), e.consume(t), e.exit("taskListCheckMarker"), e.exit("taskListCheck"), s) : n(t);
	}
	function s(r) {
		return P(r) ? t(r) : I(r) ? e.check({ tokenize: _l }, t, n)(r) : n(r);
	}
}
function _l(e, t, n) {
	return L(e, r, "whitespace");
	function r(e) {
		return e === null ? n(e) : t(e);
	}
}
//#endregion
//#region node_modules/micromark-extension-gfm/index.js
function vl(e) {
	return Ot([
		Fc(),
		Zc(),
		il(e),
		cl(),
		hl()
	]);
}
//#endregion
//#region node_modules/remark-gfm/lib/index.js
var yl = {};
function bl(e) {
	let t = this, n = e || yl, r = t.data(), i = r.micromarkExtensions ||= [], a = r.fromMarkdownExtensions ||= [], o = r.toMarkdownExtensions ||= [];
	i.push(vl(n)), a.push(Tc()), o.push(Ec(n));
}
//#endregion
//#region node_modules/lucide-react/dist/esm/shared/src/utils/mergeClasses.mjs
var xl = (...e) => e.filter((e, t, n) => !!e && e.trim() !== "" && n.indexOf(e) === t).join(" ").trim(), Sl = (e) => e.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase(), Cl = (e) => e.replace(/^([A-Z])|[\s-_]+(\w)/g, (e, t, n) => n ? n.toUpperCase() : t.toLowerCase()), wl = (e) => {
	let t = Cl(e);
	return t.charAt(0).toUpperCase() + t.slice(1);
}, Tl = {
	xmlns: "http://www.w3.org/2000/svg",
	width: 24,
	height: 24,
	viewBox: "0 0 24 24",
	fill: "none",
	stroke: "currentColor",
	strokeWidth: 2,
	strokeLinecap: "round",
	strokeLinejoin: "round"
}, El = (e) => {
	for (let t in e) if (t.startsWith("aria-") || t === "role" || t === "title") return !0;
	return !1;
}, Dl = (0, U.createContext)({}), K = () => (0, U.useContext)(Dl), q = (0, U.forwardRef)(({ color: e, size: t, strokeWidth: n, absoluteStrokeWidth: r, className: i = "", children: a, iconNode: o, ...s }, c) => {
	let { size: l = 24, strokeWidth: u = 2, absoluteStrokeWidth: d = !1, color: f = "currentColor", className: p = "" } = K() ?? {}, m = r ?? d ? Number(n ?? u) * 24 / Number(t ?? l) : n ?? u;
	return (0, U.createElement)("svg", {
		ref: c,
		...Tl,
		width: t ?? l ?? Tl.width,
		height: t ?? l ?? Tl.height,
		stroke: e ?? f,
		strokeWidth: m,
		className: xl("lucide", p, i),
		...!a && !El(s) && { "aria-hidden": "true" },
		...s
	}, [...o.map(([e, t]) => (0, U.createElement)(e, t)), ...Array.isArray(a) ? a : [a]]);
}), J = (e, t) => {
	let n = (0, U.forwardRef)(({ className: n, ...r }, i) => (0, U.createElement)(q, {
		ref: i,
		iconNode: t,
		className: xl(`lucide-${Sl(wl(e))}`, `lucide-${e}`, n),
		...r
	}));
	return n.displayName = wl(e), n;
}, Y = J("chevron-left", [["path", {
	d: "m15 18-6-6 6-6",
	key: "1wnfg3"
}]]), X = J("chevron-right", [["path", {
	d: "m9 18 6-6-6-6",
	key: "mthhwq"
}]]), Ol = J("files", [
	["path", {
		d: "M15 2h-4a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V8",
		key: "14sh0y"
	}],
	["path", {
		d: "M16.706 2.706A2.4 2.4 0 0 0 15 2v5a1 1 0 0 0 1 1h5a2.4 2.4 0 0 0-.706-1.706z",
		key: "1970lx"
	}],
	["path", {
		d: "M5 7a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h8a2 2 0 0 0 1.732-1",
		key: "l4dndm"
	}]
]), kl = J("list-tree", [
	["path", {
		d: "M8 5h13",
		key: "1pao27"
	}],
	["path", {
		d: "M13 12h8",
		key: "h98zly"
	}],
	["path", {
		d: "M13 19h8",
		key: "c3s6r1"
	}],
	["path", {
		d: "M3 10a2 2 0 0 0 2 2h3",
		key: "1npucw"
	}],
	["path", {
		d: "M3 5v12a2 2 0 0 0 2 2h3",
		key: "x1gjn2"
	}]
]), Al = J("refresh-cw", [
	["path", {
		d: "M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8",
		key: "v9h5vc"
	}],
	["path", {
		d: "M21 3v5h-5",
		key: "1q7to0"
	}],
	["path", {
		d: "M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16",
		key: "3uifl3"
	}],
	["path", {
		d: "M8 16H3v5",
		key: "1cv678"
	}]
]), jl = J("x", [["path", {
	d: "M18 6 6 18",
	key: "1bl5f8"
}], ["path", {
	d: "m6 6 12 12",
	key: "d8bk6v"
}]]), Ml = _(), Nl = /[\0-\x1F!-,\.\/:-@\[-\^`\{-\xA9\xAB-\xB4\xB6-\xB9\xBB-\xBF\xD7\xF7\u02C2-\u02C5\u02D2-\u02DF\u02E5-\u02EB\u02ED\u02EF-\u02FF\u0375\u0378\u0379\u037E\u0380-\u0385\u0387\u038B\u038D\u03A2\u03F6\u0482\u0530\u0557\u0558\u055A-\u055F\u0589-\u0590\u05BE\u05C0\u05C3\u05C6\u05C8-\u05CF\u05EB-\u05EE\u05F3-\u060F\u061B-\u061F\u066A-\u066D\u06D4\u06DD\u06DE\u06E9\u06FD\u06FE\u0700-\u070F\u074B\u074C\u07B2-\u07BF\u07F6-\u07F9\u07FB\u07FC\u07FE\u07FF\u082E-\u083F\u085C-\u085F\u086B-\u089F\u08B5\u08C8-\u08D2\u08E2\u0964\u0965\u0970\u0984\u098D\u098E\u0991\u0992\u09A9\u09B1\u09B3-\u09B5\u09BA\u09BB\u09C5\u09C6\u09C9\u09CA\u09CF-\u09D6\u09D8-\u09DB\u09DE\u09E4\u09E5\u09F2-\u09FB\u09FD\u09FF\u0A00\u0A04\u0A0B-\u0A0E\u0A11\u0A12\u0A29\u0A31\u0A34\u0A37\u0A3A\u0A3B\u0A3D\u0A43-\u0A46\u0A49\u0A4A\u0A4E-\u0A50\u0A52-\u0A58\u0A5D\u0A5F-\u0A65\u0A76-\u0A80\u0A84\u0A8E\u0A92\u0AA9\u0AB1\u0AB4\u0ABA\u0ABB\u0AC6\u0ACA\u0ACE\u0ACF\u0AD1-\u0ADF\u0AE4\u0AE5\u0AF0-\u0AF8\u0B00\u0B04\u0B0D\u0B0E\u0B11\u0B12\u0B29\u0B31\u0B34\u0B3A\u0B3B\u0B45\u0B46\u0B49\u0B4A\u0B4E-\u0B54\u0B58-\u0B5B\u0B5E\u0B64\u0B65\u0B70\u0B72-\u0B81\u0B84\u0B8B-\u0B8D\u0B91\u0B96-\u0B98\u0B9B\u0B9D\u0BA0-\u0BA2\u0BA5-\u0BA7\u0BAB-\u0BAD\u0BBA-\u0BBD\u0BC3-\u0BC5\u0BC9\u0BCE\u0BCF\u0BD1-\u0BD6\u0BD8-\u0BE5\u0BF0-\u0BFF\u0C0D\u0C11\u0C29\u0C3A-\u0C3C\u0C45\u0C49\u0C4E-\u0C54\u0C57\u0C5B-\u0C5F\u0C64\u0C65\u0C70-\u0C7F\u0C84\u0C8D\u0C91\u0CA9\u0CB4\u0CBA\u0CBB\u0CC5\u0CC9\u0CCE-\u0CD4\u0CD7-\u0CDD\u0CDF\u0CE4\u0CE5\u0CF0\u0CF3-\u0CFF\u0D0D\u0D11\u0D45\u0D49\u0D4F-\u0D53\u0D58-\u0D5E\u0D64\u0D65\u0D70-\u0D79\u0D80\u0D84\u0D97-\u0D99\u0DB2\u0DBC\u0DBE\u0DBF\u0DC7-\u0DC9\u0DCB-\u0DCE\u0DD5\u0DD7\u0DE0-\u0DE5\u0DF0\u0DF1\u0DF4-\u0E00\u0E3B-\u0E3F\u0E4F\u0E5A-\u0E80\u0E83\u0E85\u0E8B\u0EA4\u0EA6\u0EBE\u0EBF\u0EC5\u0EC7\u0ECE\u0ECF\u0EDA\u0EDB\u0EE0-\u0EFF\u0F01-\u0F17\u0F1A-\u0F1F\u0F2A-\u0F34\u0F36\u0F38\u0F3A-\u0F3D\u0F48\u0F6D-\u0F70\u0F85\u0F98\u0FBD-\u0FC5\u0FC7-\u0FFF\u104A-\u104F\u109E\u109F\u10C6\u10C8-\u10CC\u10CE\u10CF\u10FB\u1249\u124E\u124F\u1257\u1259\u125E\u125F\u1289\u128E\u128F\u12B1\u12B6\u12B7\u12BF\u12C1\u12C6\u12C7\u12D7\u1311\u1316\u1317\u135B\u135C\u1360-\u137F\u1390-\u139F\u13F6\u13F7\u13FE-\u1400\u166D\u166E\u1680\u169B-\u169F\u16EB-\u16ED\u16F9-\u16FF\u170D\u1715-\u171F\u1735-\u173F\u1754-\u175F\u176D\u1771\u1774-\u177F\u17D4-\u17D6\u17D8-\u17DB\u17DE\u17DF\u17EA-\u180A\u180E\u180F\u181A-\u181F\u1879-\u187F\u18AB-\u18AF\u18F6-\u18FF\u191F\u192C-\u192F\u193C-\u1945\u196E\u196F\u1975-\u197F\u19AC-\u19AF\u19CA-\u19CF\u19DA-\u19FF\u1A1C-\u1A1F\u1A5F\u1A7D\u1A7E\u1A8A-\u1A8F\u1A9A-\u1AA6\u1AA8-\u1AAF\u1AC1-\u1AFF\u1B4C-\u1B4F\u1B5A-\u1B6A\u1B74-\u1B7F\u1BF4-\u1BFF\u1C38-\u1C3F\u1C4A-\u1C4C\u1C7E\u1C7F\u1C89-\u1C8F\u1CBB\u1CBC\u1CC0-\u1CCF\u1CD3\u1CFB-\u1CFF\u1DFA\u1F16\u1F17\u1F1E\u1F1F\u1F46\u1F47\u1F4E\u1F4F\u1F58\u1F5A\u1F5C\u1F5E\u1F7E\u1F7F\u1FB5\u1FBD\u1FBF-\u1FC1\u1FC5\u1FCD-\u1FCF\u1FD4\u1FD5\u1FDC-\u1FDF\u1FED-\u1FF1\u1FF5\u1FFD-\u203E\u2041-\u2053\u2055-\u2070\u2072-\u207E\u2080-\u208F\u209D-\u20CF\u20F1-\u2101\u2103-\u2106\u2108\u2109\u2114\u2116-\u2118\u211E-\u2123\u2125\u2127\u2129\u212E\u213A\u213B\u2140-\u2144\u214A-\u214D\u214F-\u215F\u2189-\u24B5\u24EA-\u2BFF\u2C2F\u2C5F\u2CE5-\u2CEA\u2CF4-\u2CFF\u2D26\u2D28-\u2D2C\u2D2E\u2D2F\u2D68-\u2D6E\u2D70-\u2D7E\u2D97-\u2D9F\u2DA7\u2DAF\u2DB7\u2DBF\u2DC7\u2DCF\u2DD7\u2DDF\u2E00-\u2E2E\u2E30-\u3004\u3008-\u3020\u3030\u3036\u3037\u303D-\u3040\u3097\u3098\u309B\u309C\u30A0\u30FB\u3100-\u3104\u3130\u318F-\u319F\u31C0-\u31EF\u3200-\u33FF\u4DC0-\u4DFF\u9FFD-\u9FFF\uA48D-\uA4CF\uA4FE\uA4FF\uA60D-\uA60F\uA62C-\uA63F\uA673\uA67E\uA6F2-\uA716\uA720\uA721\uA789\uA78A\uA7C0\uA7C1\uA7CB-\uA7F4\uA828-\uA82B\uA82D-\uA83F\uA874-\uA87F\uA8C6-\uA8CF\uA8DA-\uA8DF\uA8F8-\uA8FA\uA8FC\uA92E\uA92F\uA954-\uA95F\uA97D-\uA97F\uA9C1-\uA9CE\uA9DA-\uA9DF\uA9FF\uAA37-\uAA3F\uAA4E\uAA4F\uAA5A-\uAA5F\uAA77-\uAA79\uAAC3-\uAADA\uAADE\uAADF\uAAF0\uAAF1\uAAF7-\uAB00\uAB07\uAB08\uAB0F\uAB10\uAB17-\uAB1F\uAB27\uAB2F\uAB5B\uAB6A-\uAB6F\uABEB\uABEE\uABEF\uABFA-\uABFF\uD7A4-\uD7AF\uD7C7-\uD7CA\uD7FC-\uD7FF\uE000-\uF8FF\uFA6E\uFA6F\uFADA-\uFAFF\uFB07-\uFB12\uFB18-\uFB1C\uFB29\uFB37\uFB3D\uFB3F\uFB42\uFB45\uFBB2-\uFBD2\uFD3E-\uFD4F\uFD90\uFD91\uFDC8-\uFDEF\uFDFC-\uFDFF\uFE10-\uFE1F\uFE30-\uFE32\uFE35-\uFE4C\uFE50-\uFE6F\uFE75\uFEFD-\uFF0F\uFF1A-\uFF20\uFF3B-\uFF3E\uFF40\uFF5B-\uFF65\uFFBF-\uFFC1\uFFC8\uFFC9\uFFD0\uFFD1\uFFD8\uFFD9\uFFDD-\uFFFF]|\uD800[\uDC0C\uDC27\uDC3B\uDC3E\uDC4E\uDC4F\uDC5E-\uDC7F\uDCFB-\uDD3F\uDD75-\uDDFC\uDDFE-\uDE7F\uDE9D-\uDE9F\uDED1-\uDEDF\uDEE1-\uDEFF\uDF20-\uDF2C\uDF4B-\uDF4F\uDF7B-\uDF7F\uDF9E\uDF9F\uDFC4-\uDFC7\uDFD0\uDFD6-\uDFFF]|\uD801[\uDC9E\uDC9F\uDCAA-\uDCAF\uDCD4-\uDCD7\uDCFC-\uDCFF\uDD28-\uDD2F\uDD64-\uDDFF\uDF37-\uDF3F\uDF56-\uDF5F\uDF68-\uDFFF]|\uD802[\uDC06\uDC07\uDC09\uDC36\uDC39-\uDC3B\uDC3D\uDC3E\uDC56-\uDC5F\uDC77-\uDC7F\uDC9F-\uDCDF\uDCF3\uDCF6-\uDCFF\uDD16-\uDD1F\uDD3A-\uDD7F\uDDB8-\uDDBD\uDDC0-\uDDFF\uDE04\uDE07-\uDE0B\uDE14\uDE18\uDE36\uDE37\uDE3B-\uDE3E\uDE40-\uDE5F\uDE7D-\uDE7F\uDE9D-\uDEBF\uDEC8\uDEE7-\uDEFF\uDF36-\uDF3F\uDF56-\uDF5F\uDF73-\uDF7F\uDF92-\uDFFF]|\uD803[\uDC49-\uDC7F\uDCB3-\uDCBF\uDCF3-\uDCFF\uDD28-\uDD2F\uDD3A-\uDE7F\uDEAA\uDEAD-\uDEAF\uDEB2-\uDEFF\uDF1D-\uDF26\uDF28-\uDF2F\uDF51-\uDFAF\uDFC5-\uDFDF\uDFF7-\uDFFF]|\uD804[\uDC47-\uDC65\uDC70-\uDC7E\uDCBB-\uDCCF\uDCE9-\uDCEF\uDCFA-\uDCFF\uDD35\uDD40-\uDD43\uDD48-\uDD4F\uDD74\uDD75\uDD77-\uDD7F\uDDC5-\uDDC8\uDDCD\uDDDB\uDDDD-\uDDFF\uDE12\uDE38-\uDE3D\uDE3F-\uDE7F\uDE87\uDE89\uDE8E\uDE9E\uDEA9-\uDEAF\uDEEB-\uDEEF\uDEFA-\uDEFF\uDF04\uDF0D\uDF0E\uDF11\uDF12\uDF29\uDF31\uDF34\uDF3A\uDF45\uDF46\uDF49\uDF4A\uDF4E\uDF4F\uDF51-\uDF56\uDF58-\uDF5C\uDF64\uDF65\uDF6D-\uDF6F\uDF75-\uDFFF]|\uD805[\uDC4B-\uDC4F\uDC5A-\uDC5D\uDC62-\uDC7F\uDCC6\uDCC8-\uDCCF\uDCDA-\uDD7F\uDDB6\uDDB7\uDDC1-\uDDD7\uDDDE-\uDDFF\uDE41-\uDE43\uDE45-\uDE4F\uDE5A-\uDE7F\uDEB9-\uDEBF\uDECA-\uDEFF\uDF1B\uDF1C\uDF2C-\uDF2F\uDF3A-\uDFFF]|\uD806[\uDC3B-\uDC9F\uDCEA-\uDCFE\uDD07\uDD08\uDD0A\uDD0B\uDD14\uDD17\uDD36\uDD39\uDD3A\uDD44-\uDD4F\uDD5A-\uDD9F\uDDA8\uDDA9\uDDD8\uDDD9\uDDE2\uDDE5-\uDDFF\uDE3F-\uDE46\uDE48-\uDE4F\uDE9A-\uDE9C\uDE9E-\uDEBF\uDEF9-\uDFFF]|\uD807[\uDC09\uDC37\uDC41-\uDC4F\uDC5A-\uDC71\uDC90\uDC91\uDCA8\uDCB7-\uDCFF\uDD07\uDD0A\uDD37-\uDD39\uDD3B\uDD3E\uDD48-\uDD4F\uDD5A-\uDD5F\uDD66\uDD69\uDD8F\uDD92\uDD99-\uDD9F\uDDAA-\uDEDF\uDEF7-\uDFAF\uDFB1-\uDFFF]|\uD808[\uDF9A-\uDFFF]|\uD809[\uDC6F-\uDC7F\uDD44-\uDFFF]|[\uD80A\uD80B\uD80E-\uD810\uD812-\uD819\uD824-\uD82B\uD82D\uD82E\uD830-\uD833\uD837\uD839\uD83D\uD83F\uD87B-\uD87D\uD87F\uD885-\uDB3F\uDB41-\uDBFF][\uDC00-\uDFFF]|\uD80D[\uDC2F-\uDFFF]|\uD811[\uDE47-\uDFFF]|\uD81A[\uDE39-\uDE3F\uDE5F\uDE6A-\uDECF\uDEEE\uDEEF\uDEF5-\uDEFF\uDF37-\uDF3F\uDF44-\uDF4F\uDF5A-\uDF62\uDF78-\uDF7C\uDF90-\uDFFF]|\uD81B[\uDC00-\uDE3F\uDE80-\uDEFF\uDF4B-\uDF4E\uDF88-\uDF8E\uDFA0-\uDFDF\uDFE2\uDFE5-\uDFEF\uDFF2-\uDFFF]|\uD821[\uDFF8-\uDFFF]|\uD823[\uDCD6-\uDCFF\uDD09-\uDFFF]|\uD82C[\uDD1F-\uDD4F\uDD53-\uDD63\uDD68-\uDD6F\uDEFC-\uDFFF]|\uD82F[\uDC6B-\uDC6F\uDC7D-\uDC7F\uDC89-\uDC8F\uDC9A-\uDC9C\uDC9F-\uDFFF]|\uD834[\uDC00-\uDD64\uDD6A-\uDD6C\uDD73-\uDD7A\uDD83\uDD84\uDD8C-\uDDA9\uDDAE-\uDE41\uDE45-\uDFFF]|\uD835[\uDC55\uDC9D\uDCA0\uDCA1\uDCA3\uDCA4\uDCA7\uDCA8\uDCAD\uDCBA\uDCBC\uDCC4\uDD06\uDD0B\uDD0C\uDD15\uDD1D\uDD3A\uDD3F\uDD45\uDD47-\uDD49\uDD51\uDEA6\uDEA7\uDEC1\uDEDB\uDEFB\uDF15\uDF35\uDF4F\uDF6F\uDF89\uDFA9\uDFC3\uDFCC\uDFCD]|\uD836[\uDC00-\uDDFF\uDE37-\uDE3A\uDE6D-\uDE74\uDE76-\uDE83\uDE85-\uDE9A\uDEA0\uDEB0-\uDFFF]|\uD838[\uDC07\uDC19\uDC1A\uDC22\uDC25\uDC2B-\uDCFF\uDD2D-\uDD2F\uDD3E\uDD3F\uDD4A-\uDD4D\uDD4F-\uDEBF\uDEFA-\uDFFF]|\uD83A[\uDCC5-\uDCCF\uDCD7-\uDCFF\uDD4C-\uDD4F\uDD5A-\uDFFF]|\uD83B[\uDC00-\uDDFF\uDE04\uDE20\uDE23\uDE25\uDE26\uDE28\uDE33\uDE38\uDE3A\uDE3C-\uDE41\uDE43-\uDE46\uDE48\uDE4A\uDE4C\uDE50\uDE53\uDE55\uDE56\uDE58\uDE5A\uDE5C\uDE5E\uDE60\uDE63\uDE65\uDE66\uDE6B\uDE73\uDE78\uDE7D\uDE7F\uDE8A\uDE9C-\uDEA0\uDEA4\uDEAA\uDEBC-\uDFFF]|\uD83C[\uDC00-\uDD2F\uDD4A-\uDD4F\uDD6A-\uDD6F\uDD8A-\uDFFF]|\uD83E[\uDC00-\uDFEF\uDFFA-\uDFFF]|\uD869[\uDEDE-\uDEFF]|\uD86D[\uDF35-\uDF3F]|\uD86E[\uDC1E\uDC1F]|\uD873[\uDEA2-\uDEAF]|\uD87A[\uDFE1-\uDFFF]|\uD87E[\uDE1E-\uDFFF]|\uD884[\uDF4B-\uDFFF]|\uDB40[\uDC00-\uDCFF\uDDF0-\uDFFF]/g, Pl = Object.hasOwnProperty, Fl = class {
	constructor() {
		this.occurrences, this.reset();
	}
	slug(e, t) {
		let n = this, r = Il(e, t === !0), i = r;
		for (; Pl.call(n.occurrences, r);) n.occurrences[i]++, r = i + "-" + n.occurrences[i];
		return n.occurrences[r] = 0, r;
	}
	reset() {
		this.occurrences = Object.create(null);
	}
};
function Il(e, t) {
	return typeof e == "string" ? (t || (e = e.toLowerCase()), e.replace(Nl, "").replace(/ /g, "-")) : "";
}
//#endregion
//#region src/MarkdownReader/markdownOutline.ts
function Ll(e) {
	if (!/^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(e)) throw Error("Invalid reader identity.");
	let t = [];
	return {
		headings: t,
		plugin: () => (n) => {
			let r = new Fl();
			t.length = 0, xa(n, "heading", (n) => {
				let i = yt(n), a = r.slug(Il(i) ? i : "section"), o = `${e}-heading-${a}`;
				t.push({
					logicalSlug: a,
					domId: o,
					label: i || "Section",
					depth: n.depth,
					order: t.length,
					sourceOffset: n.position?.start.offset
				}), n.data ??= {}, n.data.hProperties = {
					...n.data.hProperties,
					id: o,
					"data-reader-heading": !0,
					"data-logical-slug": a,
					tabIndex: -1
				};
			});
		}
	};
}
var Rl = (e) => (t) => {
	let n = /* @__PURE__ */ new Map();
	xa(t, "element", (t) => {
		let r = t.properties.id;
		if (typeof r != "string") return;
		let i = r.startsWith(`${e}-`) ? r : `${e}-node-${r}`;
		n.set(r, i), t.properties.id = i;
	}), xa(t, "element", (e) => {
		let t = e.properties.href;
		typeof t == "string" && t.startsWith("#") && n.has(t.slice(1)) && (e.properties.href = `#${n.get(t.slice(1))}`);
		for (let t of ["ariaDescribedBy", "ariaLabelledBy"]) {
			let r = e.properties[t];
			Array.isArray(r) ? e.properties[t] = r.map((e) => n.get(String(e)) ?? e) : typeof r == "string" && (e.properties[t] = r.split(/\s+/).map((e) => n.get(e) ?? e).join(" "));
		}
	});
};
//#endregion
//#region src/MarkdownReader/MarkdownTableOfContents/MarkdownTableOfContents.tsx
function zl(e) {
	let t = [], n = [];
	for (let r of e) {
		for (; n.length && n.at(-1).heading.depth >= r.depth;) n.pop();
		let e = {
			heading: r,
			children: []
		};
		n.length ? n.at(-1).children.push(e) : t.push(e), n.push(e);
	}
	return t;
}
function Bl({ readerId: e, headings: t, activeSlug: n, compact: r, background: i = [], getBackground: a, onNavigate: o }) {
	let [s, c] = (0, U.useState)(!1), l = (0, U.useRef)(null), u = (0, U.useRef)(null), d = (0, U.useRef)(null), f = () => {
		d.current = { dismiss: !0 }, c(!1);
	};
	(0, U.useLayoutEffect)(() => {
		if (!s || !r || !u.current) {
			!r && s && c(!1);
			let e = d.current;
			d.current = null, e?.slug ? o(e.slug, e.activation ?? "keyboard") : e?.dismiss && l.current?.isConnected && l.current.focus({ preventScroll: !0 });
			return;
		}
		let e = u.current, t = e.ownerDocument, n = new Map((a?.() ?? i).map((e) => [e, e.inert]));
		for (let e of n.keys()) e.inert = !0;
		let p = () => [...e.querySelectorAll("button:not(:disabled),a[href],select:not(:disabled),[tabindex=\"0\"]")];
		p()[0]?.focus({ preventScroll: !0 });
		let m = (e) => {
			if (e.key === "Escape") e.preventDefault(), e.stopPropagation(), f();
			else if (e.key === "Tab") {
				let n = p();
				if (!n.length) return;
				e.preventDefault(), e.stopPropagation(), n[(n.indexOf(t.activeElement) + (e.shiftKey ? -1 : 1) + n.length) % n.length]?.focus();
			}
		}, h = (t) => {
			e.contains(t.target) || p()[0]?.focus({ preventScroll: !0 });
		};
		return t.addEventListener("keydown", m, !0), t.addEventListener("focusin", h, !0), () => {
			t.removeEventListener("keydown", m, !0), t.removeEventListener("focusin", h, !0);
			for (let [e, t] of n) e.inert = t;
		};
	}, [s, r]);
	let p = (e, t) => {
		r ? (d.current = {
			slug: e,
			activation: t
		}, c(!1)) : o(e, t);
	}, m = (e) => /* @__PURE__ */ (0, H.jsx)("ol", {
		className: "md-reader__toc-list",
		children: e.map(({ heading: e, children: t }) => /* @__PURE__ */ (0, H.jsxs)("li", { children: [/* @__PURE__ */ (0, H.jsx)("button", {
			type: "button",
			"data-toc-slug": e.logicalSlug,
			"aria-current": n === e.logicalSlug ? "location" : void 0,
			title: e.label,
			onClick: (t) => p(e.logicalSlug, t.detail === 0 ? "keyboard" : "pointer"),
			children: e.label
		}), t.length > 0 && m(t)] }, e.domId))
	}), h = m(zl(t)), g = /* @__PURE__ */ (0, H.jsxs)("div", {
		className: "md-reader__toc-title",
		id: `${e}-toc-title`,
		children: [/* @__PURE__ */ (0, H.jsx)(kl, {
			size: 16,
			"aria-hidden": "true"
		}), /* @__PURE__ */ (0, H.jsx)("span", { children: "Table of contents" })]
	});
	return t.length ? r ? /* @__PURE__ */ (0, H.jsxs)("div", {
		className: "md-reader__toc-compact",
		children: [/* @__PURE__ */ (0, H.jsxs)("button", {
			ref: l,
			className: "md-reader__toc-trigger",
			type: "button",
			"aria-label": "Table of contents",
			"aria-expanded": s,
			"aria-controls": `${e}-toc-drawer`,
			onClick: () => c(!0),
			children: [/* @__PURE__ */ (0, H.jsx)(kl, {
				size: 16,
				"aria-hidden": "true"
			}), /* @__PURE__ */ (0, H.jsx)("span", { children: "Table of contents" })]
		}), s && /* @__PURE__ */ (0, H.jsxs)(H.Fragment, { children: [/* @__PURE__ */ (0, H.jsx)("div", {
			className: "md-reader__toc-backdrop",
			"aria-hidden": "true",
			onClick: f
		}), /* @__PURE__ */ (0, H.jsxs)("div", {
			ref: u,
			className: "md-reader__toc-drawer",
			id: `${e}-toc-drawer`,
			role: "dialog",
			"aria-modal": "true",
			"aria-labelledby": `${e}-toc-title`,
			children: [/* @__PURE__ */ (0, H.jsxs)("div", {
				className: "md-reader__toc-drawer-header",
				children: [g, /* @__PURE__ */ (0, H.jsx)("button", {
					type: "button",
					className: "md-reader__toc-close",
					"aria-label": "Close table of contents",
					title: "Close table of contents",
					onClick: f,
					children: /* @__PURE__ */ (0, H.jsx)(jl, {
						size: 16,
						"aria-hidden": "true"
					})
				})]
			}), /* @__PURE__ */ (0, H.jsx)("nav", {
				"aria-label": "Table of contents",
				children: h
			})]
		})] })]
	}) : /* @__PURE__ */ (0, H.jsxs)("nav", {
		className: "md-reader__toc",
		"aria-label": "Table of contents",
		children: [g, h]
	}) : null;
}
//#endregion
//#region src/MarkdownReader/useActiveMarkdownHeading.ts
function Vl(e, t, n) {
	if (!e.length) return null;
	let r = t + n * .25, i = e[0].logicalSlug;
	for (let t of e) {
		if (t.top > r) break;
		i = t.logicalSlug;
	}
	return i;
}
function Hl(e, t, n, r, i = {}) {
	let a = e.ownerDocument.defaultView;
	if (!a) return () => {};
	let o = i.requestFrame ?? a.requestAnimationFrame?.bind(a) ?? ((e) => a.setTimeout(() => e(a.performance.now()), 0)), s = i.cancelFrame ?? a.cancelAnimationFrame?.bind(a) ?? a.clearTimeout.bind(a), c = i.ResizeObserver ?? a.ResizeObserver, l = new Map([...e.querySelectorAll("[data-reader-heading]")].map((e) => [e.id, e])), u = [], d = null, f = !0, p = !1, m = () => {
		if (d = null, !p) {
			if (f) {
				let e = t.getBoundingClientRect().top;
				u = n.flatMap((n) => {
					let r = l.get(n.domId);
					return r ? [{
						logicalSlug: n.logicalSlug,
						top: r.getBoundingClientRect().top - e + t.scrollTop
					}] : [];
				}).sort((e, t) => e.top - t.top), f = !1;
			}
			r(Vl(u, t.scrollTop, t.clientHeight));
		}
	}, h = (e = !1) => {
		p || (f ||= e, d === null && (d = o(m)));
	}, g = () => h(), _ = () => h(!0), v = c ? new c(_) : null;
	return v?.observe(e), v?.observe(t), t.addEventListener("scroll", g, { passive: !0 }), a.addEventListener("resize", _), e.ownerDocument.fonts?.ready.then(_).catch(() => {}), h(!0), () => {
		p || (p = !0, d !== null && s(d), d = null, v?.disconnect(), t.removeEventListener("scroll", g), a.removeEventListener("resize", _), l.clear(), u = []);
	};
}
function Ul(e, t, n, r, i = !0) {
	let a = n.find((e) => e.logicalSlug === r);
	if (!a) return !1;
	let o = [...e.querySelectorAll("[data-reader-heading]")].find((e) => e.id === a.domId);
	if (!o) return !1;
	let s = Math.max(0, t.scrollTop + o.getBoundingClientRect().top - t.getBoundingClientRect().top - t.clientHeight * .25), c = e.ownerDocument.defaultView?.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? !0;
	return typeof t.scrollTo == "function" ? t.scrollTo({
		top: s,
		behavior: c ? "auto" : "smooth"
	}) : t.scrollTop = s, i && o.focus({ preventScroll: !0 }), !0;
}
function Wl(e, t, n) {
	let [r, i] = (0, U.useState)(n[0]?.logicalSlug ?? null);
	return (0, U.useLayoutEffect)(() => {
		if (!(!e.current || !t)) return Hl(e.current, t, n, i);
	}, [
		e,
		t,
		n
	]), {
		activeSlug: n.some((e) => e.logicalSlug === r) ? r : n[0]?.logicalSlug ?? null,
		navigate(r, a = !0) {
			e.current && Ul(e.current, t, n, r, a) && i(r);
		}
	};
}
//#endregion
//#region src/MarkdownReader/MarkdownReader.tsx
var Gl = {
	idle: "Select an artifact to review.",
	loading: "Loading artifact...",
	ready: "",
	changed: "Source changed. Displayed content is stale.",
	missing: "This artifact has not been generated yet.",
	deleted: "This artifact was deleted. Choose another artifact.",
	unsupported: "This artifact cannot be reviewed.",
	empty: "This artifact is empty.",
	"no-heading": "This document has no sections.",
	error: "The artifact could not be read. Try refreshing it."
}, Kl = (0, U.createContext)(null);
function ql(e) {
	return () => (t) => {
		xa(t, "text", (t, n, r) => {
			if (n === void 0 || !r || ["link", "linkReference"].includes(r.type)) return;
			let i = [], a = 0;
			for (let n of t.value.matchAll(/\[NEEDS CLARIFICATION:\s*([^\]]+)\]/gi)) {
				let r = n[1].trim(), o = e.find((e) => e.question === r && (e.sourceStart === void 0 || e.sourceStart === (t.position?.start.offset ?? 0) + n.index));
				o && (n.index > a && i.push({
					type: "text",
					value: t.value.slice(a, n.index)
				}), i.push({
					type: "emphasis",
					children: [{
						type: "text",
						value: n[0]
					}],
					data: {
						hName: "span",
						hProperties: { "data-clarification-id": o.id }
					}
				}), a = n.index + n[0].length);
			}
			if (i.length) return a < t.value.length && i.push({
				type: "text",
				value: t.value.slice(a)
			}), r.children.splice(n, 1, ...i), n + i.length;
		});
	};
}
function Jl({ children: e, node: t }) {
	let n = (0, U.useContext)(Kl), r = t?.properties["data-clarification-id"], i = n?.options.clarifications?.find((e) => e.id === r && e.artifactId === n.options.document?.artifact.id && e.revision === n.options.document?.revision);
	return !i || !n?.options.onClarification ? /* @__PURE__ */ (0, H.jsx)("span", { children: e }) : /* @__PURE__ */ (0, H.jsxs)("span", {
		className: "md-reader__clarification",
		children: [
			/* @__PURE__ */ (0, H.jsx)("mark", { children: e }),
			" ",
			/* @__PURE__ */ (0, H.jsx)("button", {
				type: "button",
				"data-clarification-id": i.id,
				className: "md-reader__clarify-button",
				disabled: ["submitting", "stale"].includes(i.status ?? "") || n.options.state === "changed",
				"aria-label": `Clarify: ${i.question}`,
				title: i.question,
				onClick: () => n.options.onClarification?.(i.id),
				children: i.answer ? "Answer queued" : "Clarify"
			})
		]
	});
}
function Yl(e) {
	if (!e || /^[\s\\/]|[\x00-\x1f\x7f]/.test(e)) return !1;
	if (/^https?:\/\//i.test(e)) try {
		let t = new URL(e);
		return !t.username && !t.password;
	} catch {
		return !1;
	}
	return !e.includes(":");
}
function Xl({ href: e, children: t, node: n, id: r, ...i }) {
	let a = (0, U.useContext)(Kl);
	if (!a?.options.navigationEnabled || !Yl(e)) return /* @__PURE__ */ (0, H.jsx)("span", { children: t });
	let o = Object.hasOwn(n?.properties ?? {}, "dataFootnoteRef"), s = Object.hasOwn(n?.properties ?? {}, "dataFootnoteBackref");
	return /* @__PURE__ */ (0, H.jsx)("a", {
		href: o || s ? e : "#",
		id: r,
		referrerPolicy: "no-referrer",
		rel: "noopener noreferrer",
		"data-footnote-ref": o || void 0,
		"data-footnote-backref": s || void 0,
		"aria-describedby": i["aria-describedby"],
		"aria-label": i["aria-label"],
		onAuxClick: (e) => e.preventDefault(),
		onClick: (t) => {
			if (t.preventDefault(), (o || s) && e?.startsWith("#")) {
				let t = [...a.root.current?.querySelectorAll("[id]") ?? []].find((t) => t.id === e.slice(1));
				if (t) {
					let e = a.options.scrollElement;
					e.scrollTop += t.getBoundingClientRect().top - e.getBoundingClientRect().top, t.tabIndex = -1, t.focus({ preventScroll: !0 });
				}
				return;
			}
			a.options.onNavigateReference(e);
		},
		children: t
	});
}
var Zl = {
	a: Xl,
	span: Jl,
	img: ({ alt: e }) => /* @__PURE__ */ (0, H.jsxs)("span", {
		className: "md-reader__image-placeholder",
		role: "img",
		"aria-label": e || "Image unavailable",
		children: [
			"[Image: ",
			e || "unavailable",
			"]"
		]
	}),
	input: ({ checked: e }) => /* @__PURE__ */ (0, H.jsx)("input", {
		type: "checkbox",
		checked: !!e,
		disabled: !0,
		"aria-label": e ? "Completed task" : "Incomplete task"
	}),
	table: ({ children: e }) => /* @__PURE__ */ (0, H.jsx)("div", {
		className: "md-reader__table-scroll",
		role: "region",
		"aria-label": "Table",
		tabIndex: 0,
		children: /* @__PURE__ */ (0, H.jsx)("table", { children: e })
	})
};
function Ql({ options: e }) {
	let t = (0, U.useRef)(null), n = (0, U.useRef)(null), r = (0, U.useRef)(null), i = (0, U.useRef)(null), [a, o] = (0, U.useState)({
		compact: !0,
		height: 600
	}), s = e.document, c = !!(s && [
		"ready",
		"no-heading",
		"changed"
	].includes(e.state)), l = c ? s.content : "", u = JSON.stringify((e.clarifications ?? []).filter((e) => e.artifactId === s?.artifact.id && e.revision === s?.revision && /^[A-Za-z0-9_-]{1,256}$/.test(e.id) && e.question.length <= 4e3 && /^speckit[.-][a-z0-9.-]+$/i.test(e.commandName)).map(({ id: e, question: t, sourceStart: n }) => ({
		id: e,
		question: t,
		sourceStart: n
	}))), d = (0, U.useMemo)(() => {
		let t = Ll(e.readerId), n = JSON.parse(u);
		return {
			body: vo({
				children: l,
				skipHtml: !0,
				remarkPlugins: [
					bl,
					t.plugin,
					ql(n)
				],
				rehypePlugins: [[Rl, e.readerId]],
				components: Zl
			}),
			headings: t.headings
		};
	}, [
		l,
		e.readerId,
		u
	]), f = s && ["ready", "no-heading"].includes(e.state) ? l.trim() ? d.headings.length ? "ready" : "no-heading" : "empty" : e.state, p = c && f !== "empty", m = Wl(t, e.scrollElement, d.headings);
	return (0, U.useLayoutEffect)(() => {
		let n = t.current;
		if (!n) return;
		let r = n.ownerDocument.defaultView, i = () => {
			let t = n.clientWidth < 820, r = Math.max(200, (e.scrollElement.clientHeight || 624) - 24);
			o((e) => e.compact === t && e.height === r ? e : {
				compact: t,
				height: r
			});
		}, a = r?.ResizeObserver ? new r.ResizeObserver(i) : null;
		return a?.observe(n), a?.observe(e.scrollElement), r?.addEventListener("resize", i), i(), () => {
			a?.disconnect(), r?.removeEventListener("resize", i);
		};
	}, [e.scrollElement]), (0, U.useLayoutEffect)(() => {
		t.current && e.fragment && Ul(t.current, e.scrollElement, d.headings, e.fragment);
	}, [
		e.fragment,
		e.scrollElement,
		d.headings,
		a.compact
	]), (0, U.useEffect)(() => {
		e.onRendered?.({
			readerId: e.readerId,
			artifactId: e.selectedArtifactId,
			revision: s?.revision,
			state: f,
			activeFragment: m.activeSlug ?? void 0
		});
	}, [
		e.readerId,
		e.selectedArtifactId,
		e.onRendered,
		f,
		s?.revision,
		m.activeSlug
	]), /* @__PURE__ */ (0, H.jsx)(Kl.Provider, {
		value: {
			options: e,
			root: t
		},
		children: /* @__PURE__ */ (0, H.jsxs)("section", {
			ref: t,
			className: "md-reader",
			"data-reader-id": e.readerId,
			"data-reader-state": f,
			"data-reader-connection": e.connectionState,
			"data-reader-layout": a.compact ? "compact" : "wide",
			style: { "--md-toc-height": `${a.height}px` },
			"data-artifact-id": e.selectedArtifactId,
			"data-revision": s?.revision,
			"aria-busy": e.state === "loading",
			onKeyDown: (t) => {
				t.key === "Escape" && (t.preventDefault(), t.stopPropagation(), e.onReturnToWorkflow());
			},
			children: [
				e.navigationEnabled && /* @__PURE__ */ (0, H.jsxs)("nav", {
					ref: r,
					className: "md-reader__toolbar",
					"aria-label": "Artifact navigation",
					children: [
						/* @__PURE__ */ (0, H.jsx)("button", {
							type: "button",
							"aria-label": "Previous artifact",
							title: "Previous artifact",
							disabled: !e.canNavigateBack,
							onClick: () => e.onNavigateHistory("back"),
							children: /* @__PURE__ */ (0, H.jsx)(Y, {
								size: 16,
								"aria-hidden": "true"
							})
						}),
						/* @__PURE__ */ (0, H.jsx)("button", {
							type: "button",
							"aria-label": "Next artifact",
							title: "Next artifact",
							disabled: !e.canNavigateForward,
							onClick: () => e.onNavigateHistory("forward"),
							children: /* @__PURE__ */ (0, H.jsx)(X, {
								size: 16,
								"aria-hidden": "true"
							})
						}),
						/* @__PURE__ */ (0, H.jsx)(Ol, {
							size: 16,
							"aria-hidden": "true"
						}),
						/* @__PURE__ */ (0, H.jsx)("select", {
							"aria-label": "Artifacts",
							value: e.selectedArtifactId ?? "",
							onChange: (t) => e.onSelectArtifact(t.target.value),
							children: e.artifacts.map((e) => /* @__PURE__ */ (0, H.jsx)("option", {
								value: e.id,
								disabled: e.availability !== "available",
								children: e.label
							}, e.id))
						}),
						e.onRefresh && /* @__PURE__ */ (0, H.jsx)("button", {
							type: "button",
							"aria-label": "Refresh artifact",
							title: "Refresh artifact",
							disabled: e.state === "loading",
							onClick: e.onRefresh,
							children: /* @__PURE__ */ (0, H.jsx)(Al, {
								size: 16,
								"aria-hidden": "true"
							})
						})
					]
				}),
				s && /* @__PURE__ */ (0, H.jsxs)("div", {
					ref: i,
					className: "md-reader__identity",
					role: "group",
					"aria-label": "Artifact source",
					children: [/* @__PURE__ */ (0, H.jsx)("span", { children: s.artifact.relativePath }), /* @__PURE__ */ (0, H.jsxs)("small", { children: ["Working-tree revision ", s.revision.slice(7, 19)] })]
				}),
				e.connectionState === "disconnected" && /* @__PURE__ */ (0, H.jsx)("p", {
					className: "md-reader__notice",
					role: "status",
					children: "Disconnected. Displayed content may be out of date."
				}),
				p && ["changed", "no-heading"].includes(f) && /* @__PURE__ */ (0, H.jsx)("p", {
					className: "md-reader__notice",
					role: "status",
					children: Gl[f]
				}),
				p ? /* @__PURE__ */ (0, H.jsxs)("div", {
					className: `md-reader__layout${d.headings.length ? " md-reader__layout--outlined" : ""}`,
					children: [d.headings.length > 0 && /* @__PURE__ */ (0, H.jsx)(Bl, {
						readerId: e.readerId,
						headings: d.headings,
						activeSlug: m.activeSlug,
						compact: a.compact,
						getBackground: () => [
							n.current,
							r.current,
							i.current
						].filter((e) => e !== null),
						onNavigate: (e, t) => m.navigate(e, a.compact || t === "keyboard")
					}), /* @__PURE__ */ (0, H.jsx)("article", {
						ref: n,
						className: "md-reader__article",
						children: d.body
					})]
				}) : /* @__PURE__ */ (0, H.jsx)("p", {
					className: "md-reader__notice",
					role: "status",
					children: e.statusMessage || Gl[f]
				})
			]
		})
	});
}
//#endregion
//#region src/mount.tsx
var $l = /* @__PURE__ */ new WeakMap(), eu = /* @__PURE__ */ new Set(), tu = new Set([
	"idle",
	"loading",
	"ready",
	"changed",
	"missing",
	"deleted",
	"unsupported",
	"empty",
	"no-heading",
	"error"
]);
function nu(e, t) {
	if (!e?.isConnected || !e.ownerDocument) throw Error("Reader container must be connected.");
	if (!t || !/^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(t.readerId)) throw Error("Invalid readerId.");
	if (!t.scrollElement?.isConnected || !t.scrollElement.contains(e)) throw Error("Reader scroll container must be connected and contain the mount.");
	if (!tu.has(t.state)) throw Error("Invalid reader state.");
	if (!["connected", "disconnected"].includes(t.connectionState)) throw Error("Invalid connection state.");
	if (["ready", "no-heading"].includes(t.state) && !t.document) throw Error("Ready reader requires an artifact document.");
	if (t.document && [
		"idle",
		"loading",
		"missing",
		"deleted",
		"unsupported",
		"error"
	].includes(t.state)) throw Error("Invalid document for reader state.");
	if (t.state === "empty" && t.document?.content.trim()) throw Error("Empty state requires empty content.");
	if (!Array.isArray(t.artifacts)) throw Error("Invalid artifact list.");
	for (let e of [
		t.onSelectArtifact,
		t.onNavigateReference,
		t.onNavigateHistory,
		t.onReturnToWorkflow
	]) if (typeof e != "function") throw Error("Invalid reader callback.");
	if (t.document) {
		if (t.document.artifact.id !== t.selectedArtifactId) throw Error("Selected artifact does not match document.");
		if (!t.artifacts.some((e) => e.id === t.selectedArtifactId && e.relativePath === t.document?.artifact.relativePath)) throw Error("Document is not in the current artifact list.");
		if (!/^sha256:[0-9a-f]{64}$/.test(t.document.revision)) throw Error("Invalid document revision.");
		if (t.document.sourceKind !== "working-tree" || typeof t.document.content != "string") throw Error("Invalid artifact source.");
		if (!Number.isInteger(t.document.byteSize) || t.document.byteSize < 0 || t.document.byteSize > 5242880) throw Error("Invalid artifact byte size.");
	}
}
function ru(e, t) {
	if (nu(e, t), $l.has(e)) throw Error("Reader already mounted in this container.");
	if (eu.has(t.readerId)) throw Error("ReaderId is already mounted.");
	let n = t.readerId, r = (0, Ml.createRoot)(e, { identifierPrefix: `${n}-` }), i = !1, a = 0, o = {
		update(t) {
			if (i) throw Error("Cannot update an unmounted reader.");
			if (nu(e, t), t.readerId !== n) throw Error("readerId cannot change during update.");
			let o = ++a;
			r.render(/* @__PURE__ */ (0, H.jsx)(Ql, { options: {
				...t,
				onRendered: (e) => {
					!i && a === o && t.onRendered?.(e);
				}
			} }));
		},
		unmount() {
			i || (i = !0, a++, r.unmount(), $l.delete(e), eu.delete(n));
		}
	};
	return $l.set(e, o), eu.add(n), o.update(t), o;
}
//#endregion
export { ru as mountMarkdownReader };
