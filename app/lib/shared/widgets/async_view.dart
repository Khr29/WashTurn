import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Standard loading/error/data handling for AsyncValue so every screen
/// renders consistent loading and error states instead of ad-hoc spinners.
class AsyncView<T> extends StatelessWidget {
  final AsyncValue<T> value;
  final Widget Function(BuildContext context, T data) builder;
  final VoidCallback? onRetry;

  const AsyncView({super.key, required this.value, required this.builder, this.onRetry});

  @override
  Widget build(BuildContext context) {
    return value.when(
      data: (data) => builder(context, data),
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (err, st) => Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.error_outline, size: 40, color: Theme.of(context).colorScheme.error),
              const SizedBox(height: 12),
              Text(
                'Something went wrong.\n${err.toString()}',
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.bodyMedium,
              ),
              if (onRetry != null) ...[
                const SizedBox(height: 16),
                OutlinedButton(onPressed: onRetry, child: const Text('Retry')),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
