import '../models/turn.dart';
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
}
