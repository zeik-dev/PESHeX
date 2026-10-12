# =============================================================================
# journal.rb — Historial de transacciones con deshacer/rehacer.
#
# Una transaccion agrupa las Ops de una accion del usuario (un `apply_ops`, un
# `set_field` crudo...). Si algo falla a mitad, se revierte lo aplicado. El
# historial se vacia al guardar (el respaldo .bak cubre "volver atras").
# =============================================================================

module Sem
  class Journal
    Tx = Struct.new(:id, :label, :ops, :refs, :at)

    # Recibe las Ops de una transaccion y las aplica al instante.
    class Builder
      attr_reader :tx

      def initialize(tx)
        @tx = tx
      end

      def apply(op)
        op.apply!
        @tx.ops << op
        op
      end

      def touch(ref)
        @tx.refs << ref unless @tx.refs.include?(ref)
      end
    end

    attr_reader :undo_stack, :redo_stack

    def initialize
      @undo_stack = []
      @redo_stack = []
      @next_id = 1
    end

    def dirty?
      !@undo_stack.empty?
    end

    def pending_count
      @undo_stack.size
    end

    # Ejecuta el bloque con un Builder. Devuelve la Tx (o nil si no cambio nada).
    def transaction(label)
      tx = Tx.new(@next_id, label, [], [], Time.now)
      builder = Builder.new(tx)
      begin
        yield builder
      rescue StandardError
        tx.ops.reverse_each(&:revert!)
        raise
      end
      return nil if tx.ops.empty?

      @next_id += 1
      @undo_stack << tx
      @redo_stack.clear
      tx
    end

    # Aplica las ops, deja que el bloque las inspeccione y las REVIERTE siempre;
    # no toca el historial. Devuelve la Tx simulada.
    def preview(label)
      tx = Tx.new(0, label, [], [], Time.now)
      begin
        yield Builder.new(tx)
      ensure
        tx.ops.reverse_each(&:revert!)
      end
      tx
    end

    def undo
      tx = @undo_stack.pop
      return nil unless tx

      tx.ops.reverse_each(&:revert!)
      @redo_stack << tx
      tx
    end

    def redo
      tx = @redo_stack.pop
      return nil unless tx

      tx.ops.each(&:apply!)
      @undo_stack << tx
      tx
    end

    def structural?(tx)
      tx.ops.any?(&:structural?)
    end

    def touched_refs
      @undo_stack.flat_map(&:refs).uniq
    end

    def clear!
      @undo_stack.clear
      @redo_stack.clear
    end

    def history
      {
        undo: @undo_stack.reverse.map { |tx| tx_summary(tx) },
        redoCount: @redo_stack.size
      }
    end

    def tx_summary(tx)
      { id: tx.id, label: tx.label, refs: tx.refs, at: tx.at.utc.iso8601,
        changes: tx.ops.map(&:describe) }
    end
  end
end
