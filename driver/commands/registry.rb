# =============================================================================
# registry.rb — Registro de comandos del driver.
#
#   Commands.register('get_overview', needs_session: true) { |ctx, params| {...} }
#
# `mutates: true` marca los comandos que modifican el documento: el bucle
# principal sube `session.revision` despues de ejecutarlos con exito.
# `bumps: true` sube la revision SIN tocar el documento (p. ej. vincular la
# carpeta del juego cambia los nombres que muestran las vistas).
# El handler recibe un `Context` (sesion actual + bandera de apagado) y los
# parametros crudos de la peticion; devuelve un Hash que se fusiona en la
# respuesta (o lanza DriverError).
# =============================================================================

module Commands
  Entry = Struct.new(:name, :needs_session, :mutates, :bumps, :handler)

  class Context
    attr_accessor :session, :shutdown

    def initialize
      @session = nil
      @shutdown = false
    end
  end

  @entries = {}

  class << self
    def register(name, needs_session: true, mutates: false, bumps: false, &handler)
      @entries[name.to_s] = Entry.new(name.to_s, needs_session, mutates, bumps, handler)
    end

    def fetch(name)
      @entries[name.to_s]
    end

    def names
      @entries.keys.sort
    end

    # Ejecuta un comando; devuelve el Hash de datos de la respuesta.
    def dispatch(ctx, name, params)
      entry = fetch(name)
      raise DriverError.new('ProtocolError', "comando desconocido: #{name.inspect}") unless entry

      if entry.needs_session && ctx.session.nil?
        raise DriverError.new('NoSessionOpen', 'No hay ningun archivo abierto. Usa "open" primero.')
      end

      if entry.mutates && ctx.session # antes de tocar nada
        ctx.session.roundtrip_diff
        ctx.session.ensure_legality_baseline!
      end

      data = entry.handler.call(ctx, params) || {}
      if (entry.mutates || entry.bumps) && ctx.session && data.is_a?(Hash) && data[:applied] != false
        ctx.session.bump_revision!
      end
      data
    end
  end
end
