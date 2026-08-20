import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/api/api_exception.dart';
import '../../../core/state/auth_state.dart';
import '../../../core/state/household_state.dart';
import '../../../core/state/providers.dart';

class HouseholdOnboardingScreen extends ConsumerStatefulWidget {
  const HouseholdOnboardingScreen({super.key});

  @override
  ConsumerState<HouseholdOnboardingScreen> createState() => _HouseholdOnboardingScreenState();
}

class _HouseholdOnboardingScreenState extends ConsumerState<HouseholdOnboardingScreen>
    with SingleTickerProviderStateMixin {
  late final TabController _tabController;
  final _createNameController = TextEditingController();
  final _joinCodeController = TextEditingController();
  bool _isSubmitting = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
  }

  @override
  void dispose() {
    _tabController.dispose();
    _createNameController.dispose();
    _joinCodeController.dispose();
    super.dispose();
  }

  Future<void> _createHousehold() async {
    if (_createNameController.text.trim().isEmpty) {
      setState(() => _error = 'Enter a household name');
      return;
    }
    setState(() {
      _isSubmitting = true;
      _error = null;
    });
    try {
      final household = await ref
          .read(householdRepositoryProvider)
          .create(name: _createNameController.text.trim());
      await ref.read(householdIdProvider.notifier).set(household.id);
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } catch (_) {
      setState(() => _error = 'Could not reach the server. Check your connection and try again.');
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
  }

  Future<void> _joinHousehold() async {
    if (_joinCodeController.text.trim().isEmpty) {
      setState(() => _error = 'Enter an invite code');
      return;
    }
    setState(() {
      _isSubmitting = true;
      _error = null;
    });
    try {
      final household =
          await ref.read(householdRepositoryProvider).join(_joinCodeController.text.trim().toUpperCase());
      await ref.read(householdIdProvider.notifier).set(household.id);
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } catch (_) {
      setState(() => _error = 'Could not reach the server. Check your connection and try again.');
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Set up your household'),
        // Otherwise a user who signed into the wrong account (or just wants
        // to switch) has no way back to the login screen from here — nothing
        // downstream of this screen works without a household.
        actions: [
          IconButton(
            icon: const Icon(Icons.logout),
            tooltip: 'Log out',
            onPressed: () => ref.read(authStateProvider.notifier).logout(),
          ),
        ],
        bottom: TabBar(
          controller: _tabController,
          tabs: const [Tab(text: 'Create'), Tab(text: 'Join')],
        ),
      ),
      body: TabBarView(
        controller: _tabController,
        children: [
          _buildCreateTab(),
          _buildJoinTab(),
        ],
      ),
    );
  }

  Widget _buildCreateTab() {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const SizedBox(height: 12),
          Text(
            'Start a new household and invite the people you share the washing machine with.',
            style: Theme.of(context).textTheme.bodyMedium,
          ),
          const SizedBox(height: 20),
          TextField(
            controller: _createNameController,
            decoration: const InputDecoration(labelText: 'Household name'),
          ),
          if (_error != null) ...[
            const SizedBox(height: 12),
            Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
          ],
          const SizedBox(height: 20),
          FilledButton(
            onPressed: _isSubmitting ? null : _createHousehold,
            child: _isSubmitting
                ? SizedBox(
                    height: 20,
                    width: 20,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: Theme.of(context).colorScheme.onPrimary,
                    ))
                : const Text('Create household'),
          ),
        ],
      ),
    );
  }

  Widget _buildJoinTab() {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const SizedBox(height: 12),
          Text(
            'Ask a household member for their invite code.',
            style: Theme.of(context).textTheme.bodyMedium,
          ),
          const SizedBox(height: 20),
          TextField(
            controller: _joinCodeController,
            textCapitalization: TextCapitalization.characters,
            decoration: const InputDecoration(labelText: 'Invite code'),
          ),
          if (_error != null) ...[
            const SizedBox(height: 12),
            Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
          ],
          const SizedBox(height: 20),
          FilledButton(
            onPressed: _isSubmitting ? null : _joinHousehold,
            child: _isSubmitting
                ? SizedBox(
                    height: 20,
                    width: 20,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: Theme.of(context).colorScheme.onPrimary,
                    ))
                : const Text('Join household'),
          ),
        ],
      ),
    );
  }
}
