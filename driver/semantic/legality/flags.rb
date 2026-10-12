# =============================================================================
# flags.rb — Una "flag" es un hallazgo de legalidad sobre una entidad (Pokemon,
# entrenador, mochila, equipo). Los textos NO viven aqui: la UI traduce
# `legality.flag.<code>` con `params`.
#
#   illegal  el motor/juego no lo permite: HeX no deja INTRODUCIRLO
#   warning  raro o inconsistente, pero el juego lo tolera
#   info     dato curioso (p. ej. PIDs repetidos)
# =============================================================================

module Sem
  module Legality
    SEVERITIES = %w[illegal warning info].freeze

    Flag = Struct.new(:code, :severity, :subject, :params, keyword_init: true) do
      # Identidad para "¿es una ilegalidad NUEVA?": el codigo y el sujeto (movimiento, objeto...),
      # sin los parametros numericos (empeorar un valor no cuenta como flag nueva).
      def key
        [code, subject]
      end

      def illegal?
        severity == 'illegal'
      end

      def to_h(ref = nil)
        h = { code: code, severity: severity, params: params || {} }
        h[:subject] = subject unless subject.nil?
        h[:ref] = ref if ref
        h
      end
    end

    module_function

    def flag(code, severity, subject = nil, **params)
      Flag.new(code: code, severity: severity, subject: subject, params: params)
    end
  end
end
