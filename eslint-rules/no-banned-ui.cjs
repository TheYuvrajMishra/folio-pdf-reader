/**
 * Local ESLint rule: ban raw TouchableOpacity / ActivityIndicator.
 * DESIGN §7 + PRD §13: the only touch primitive is src/ui/Pressable
 * (press scale 0.97 + haptic); the only loading placeholder is Skeleton.
 */
module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow raw TouchableOpacity and ActivityIndicator; use src/ui/Pressable and src/ui/Skeleton.',
    },
    messages: {
      banned:
        'Do not import {{name}} from react-native. Use src/ui/Pressable (pressable) or src/ui/Skeleton (loading) instead.',
    },
    schema: [],
  },
  create(context) {
    return {
      ImportDeclaration(node) {
        if (node.source.value !== 'react-native') return;
        for (const spec of node.specifiers) {
          if (
            spec.type === 'ImportSpecifier' &&
            (spec.imported.name === 'TouchableOpacity' ||
              spec.imported.name === 'ActivityIndicator')
          ) {
            context.report({
              node: spec,
              messageId: 'banned',
              data: { name: spec.imported.name },
            });
          }
        }
      },
    };
  },
};
