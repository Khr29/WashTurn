import '../models/drying_request.dart';
import 'api_client.dart';

class DryingRepository {
  final ApiClient client;
  DryingRepository(this.client);

  Future<DryingRequest> create(String householdId, String helperId, {String? turnId}) async {
    final json = await client.post('/drying-requests', body: {
      'householdId': householdId,
      'helperId': helperId,
      if (turnId != null) 'turnId': turnId,
    });
    return DryingRequest.fromJson(json['request']);
  }

  /// scope: 'incoming' (pending, I'm the helper), 'tasks' (accepted, I'm the
  /// helper), 'outgoing' (I'm the requester), or omitted for everything
  /// involving me in this household.
  Future<List<DryingRequest>> list(String householdId, {String? scope}) async {
    final json = await client.get('/drying-requests', query: {
      'householdId': householdId,
      if (scope != null) 'scope': scope,
    });
    return (json['requests'] as List<dynamic>)
        .map((r) => DryingRequest.fromJson(r as Map<String, dynamic>))
        .toList();
  }

  Future<List<DryingFavorBalance>> balances(String householdId) async {
    final json = await client.get('/drying-requests/balances', query: {'householdId': householdId});
    return (json['balances'] as List<dynamic>)
        .map((b) => DryingFavorBalance.fromJson(b as Map<String, dynamic>))
        .toList();
  }

  Future<DryingRequest> accept(String requestId) async {
    final json = await client.post('/drying-requests/$requestId/accept');
    return DryingRequest.fromJson(json['request']);
  }

  Future<DryingRequest> reject(String requestId) async {
    final json = await client.post('/drying-requests/$requestId/reject');
    return DryingRequest.fromJson(json['request']);
  }

  Future<DryingRequest> cancel(String requestId) async {
    final json = await client.post('/drying-requests/$requestId/cancel');
    return DryingRequest.fromJson(json['request']);
  }

  Future<DryingRequest> complete(String requestId) async {
    final json = await client.post('/drying-requests/$requestId/complete');
    return DryingRequest.fromJson(json['request']);
  }
}
