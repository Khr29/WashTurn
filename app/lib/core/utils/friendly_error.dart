import '../api/api_exception.dart';

/// Backend ApiExceptions already carry a clean, human-readable message (the
/// server never leaks stack traces or raw DB errors — see server error
/// handler). Anything else reaching the UI is something we didn't
/// anticipate (a network failure, a parsing bug, ...) and must never be
/// shown to the user verbatim, per the "no raw exceptions" rule.
String friendlyErrorMessage(Object error) {
  if (error is ApiException) return error.message;
  return 'Something went wrong. Check your connection and try again.';
}
