class ApiException implements Exception {
  final int statusCode;
  final String message;

  ApiException(this.statusCode, this.message);

  bool get isAuthError => statusCode == 401;
  bool get isConflict => statusCode == 409;
  bool get isForbidden => statusCode == 403;

  @override
  String toString() => message;
}
