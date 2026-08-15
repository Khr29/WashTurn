import 'dart:convert';
import 'package:http/http.dart' as http;

import 'api_config.dart';
import 'api_exception.dart';
import 'token_store.dart';

class ApiClient {
  final TokenStore tokenStore;
  final http.Client _http;

  ApiClient({required this.tokenStore, http.Client? httpClient})
      : _http = httpClient ?? http.Client();

  Uri _uri(String path, [Map<String, String>? query]) =>
      Uri.parse('${ApiConfig.baseUrl}$path').replace(queryParameters: query);

  Future<Map<String, String>> _headers() async {
    final token = await tokenStore.read();
    return {
      'Content-Type': 'application/json',
      if (token != null) 'Authorization': 'Bearer $token',
    };
  }

  dynamic _decode(http.Response res) {
    if (res.statusCode == 204 || res.body.isEmpty) return null;
    return jsonDecode(res.body);
  }

  void _throwIfError(http.Response res, dynamic body) {
    if (res.statusCode >= 200 && res.statusCode < 300) return;
    final message = (body is Map && body['error'] is String)
        ? body['error'] as String
        : 'Request failed (${res.statusCode})';
    throw ApiException(res.statusCode, message);
  }

  Future<dynamic> get(String path, {Map<String, String>? query}) async {
    final res = await _http.get(_uri(path, query), headers: await _headers());
    final body = _decode(res);
    _throwIfError(res, body);
    return body;
  }

  Future<dynamic> post(String path, {Object? body}) async {
    final res = await _http.post(
      _uri(path),
      headers: await _headers(),
      body: body != null ? jsonEncode(body) : null,
    );
    final decoded = _decode(res);
    _throwIfError(res, decoded);
    return decoded;
  }

  Future<dynamic> put(String path, {Object? body}) async {
    final res = await _http.put(
      _uri(path),
      headers: await _headers(),
      body: body != null ? jsonEncode(body) : null,
    );
    final decoded = _decode(res);
    _throwIfError(res, decoded);
    return decoded;
  }

  Future<dynamic> patch(String path, {Object? body}) async {
    final res = await _http.patch(
      _uri(path),
      headers: await _headers(),
      body: body != null ? jsonEncode(body) : null,
    );
    final decoded = _decode(res);
    _throwIfError(res, decoded);
    return decoded;
  }

  Future<dynamic> delete(String path, {Object? body}) async {
    final res = await _http.delete(
      _uri(path),
      headers: await _headers(),
      body: body != null ? jsonEncode(body) : null,
    );
    final decoded = _decode(res);
    _throwIfError(res, decoded);
    return decoded;
  }
}
