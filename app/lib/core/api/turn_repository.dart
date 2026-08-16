import '../models/turn.dart';
import '../models/turn_request.dart';
import 'api_client.dart';

class TurnRepository {
  final ApiClient client;
  TurnRepository(this.client);

  Future<Turn> start(String turnId, {int? estimatedDurationMinutes}) async {
    final json = await client.post('/turns/$turnId/start', body: {
      if (estimatedDurationMinutes != null) 'estimatedDurationMinutes': estimatedDurationMinutes,
    });
    return Turn.fromJson(json['turn']);
  }

  Future<Turn> release(String turnId) async {
    final json = await client.post('/turns/$turnId/release');
    return Turn.fromJson(json['turn']);
  }

  Future<Turn> claim(String turnId) async {
    final json = await client.post('/turns/$turnId/claim');
    return Turn.fromJson(json['turn']);
  }

  Future<Turn> finish(String turnId) async {
    final json = await client.post('/turns/$turnId/finish');
    return Turn.fromJson(json['turn']);
  }

  Future<Turn> transfer(String turnId, String toUserId) async {
    final json = await client.post('/turns/$turnId/transfer', body: {'toUserId': toUserId});
    return Turn.fromJson(json['turn']);
  }

  Future<TurnRequest> requestTurn(String turnId) async {
    final json = await client.post('/turns/$turnId/requests');
    return TurnRequest.fromJson(json['request']);
  }

  Future<List<TurnRequest>> getRequests(String turnId) async {
    final json = await client.get('/turns/$turnId/requests');
    return (json['requests'] as List<dynamic>)
        .map((r) => TurnRequest.fromJson(r as Map<String, dynamic>))
        .toList();
  }

  Future<Turn> acceptRequest(String turnId, String requestId) async {
    final json = await client.post('/turns/$turnId/requests/$requestId/accept');
    return Turn.fromJson(json['turn']);
  }

  Future<TurnRequest> rejectRequest(String turnId, String requestId) async {
    final json = await client.post('/turns/$turnId/requests/$requestId/reject');
    return TurnRequest.fromJson(json['request']);
  }

  Future<TurnRequest> cancelRequest(String turnId, String requestId) async {
    final json = await client.post('/turns/$turnId/requests/$requestId/cancel');
    return TurnRequest.fromJson(json['request']);
  }
}
