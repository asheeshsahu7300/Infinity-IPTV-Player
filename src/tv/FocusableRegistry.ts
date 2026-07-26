type Handler = () => void;

const registry = new Map<number, Handler>();

export const FocusableRegistry = {
  register(tag: number, handler: Handler) {
    if (tag) {
      registry.set(tag, handler);
    }
  },

  unregister(tag: number) {
    if (tag) {
      registry.delete(tag);
    }
  },

  press(tag: number): boolean {
    const handler = registry.get(tag);
    if (handler) {
      handler();
      return true;
    }
    return false;
  },

  clear() {
    registry.clear();
  },
};

export default FocusableRegistry;
