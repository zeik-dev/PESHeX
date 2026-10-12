#!/usr/bin/env ruby
# =============================================================================
# rxdata_driver.rb — Protocolo JSON por linea (stdin/stdout) sobre edit_rxdata.rb
#
# No modifica edit_rxdata.rb: lo requiere como libreria (su "main" esta
# protegido con `main if $PROGRAM_NAME == __FILE__`, asi que este require no
# dispara el REPL) y reusa sus clases (RxDocument, Collector, TypeOracle, UI,
# RxMarshal, save_document, nil_report) para no duplicar logica ya validada.
#
# Protocolo: una peticion JSON por linea de entrada -> exactamente una
# respuesta JSON por linea de salida, en el mismo orden (nunca hay dos
# comandos en vuelo a la vez). Peticion: {"id":N,"cmd":"...", ...params}.
# Respuesta: {"id":N,"ok":true,...} o {"id":N,"ok":false,"error":{...}}.
# Los backtraces van a stderr (edit_rxdata.rb nunca lo usa), nunca a stdout,
# para que el stream de JSON no se rompa nunca.
#
# Estructura:
#   protocol.rb            errores y helpers de respuesta
#   session.rb             estado de un archivo abierto (indice de campos perezoso)
#   commands/registry.rb   registro de comandos
#   commands/legacy.rb     comandos crudos originales (vista Avanzado)
#   commands/semantic.rb   vistas y edicion semanticas
#   commands/gamedata.rb   carpeta del juego: nombres, catalogo, calculo de stats
#   semantic/*             capa semantica Pokemon (deteccion de base, vistas, edicion)
# =============================================================================

require 'json'
require_relative '../edit_rxdata.rb'
require_relative 'protocol'
require_relative 'session'
require_relative 'commands/registry'
require_relative 'semantic'
require_relative 'commands/legacy'
require_relative 'commands/semantic'
require_relative 'commands/gamedata'
require_relative 'commands/legality'
require_relative 'commands/extras'

C.disable!
$stdin.set_encoding(Encoding::UTF_8, Encoding::UTF_8)
$stdout.set_encoding(Encoding::UTF_8, Encoding::UTF_8)
$stdout.sync = true

# Procesa una linea de peticion; devuelve true si hay que cerrar el bucle.
def handle_request_line(ctx, line)
  id = nil
  begin
    req = JSON.parse(line)
    id = req['id']
    data = Commands.dispatch(ctx, req['cmd'], req)
    revision = ctx.session&.revision
    Protocol.ok_response(id, data, revision: revision)
  rescue JSON::ParserError => e
    Protocol.err_response(id, 'ProtocolError', "JSON invalido: #{e.message}")
  rescue DriverError => e
    Protocol.err_response(id, e.error_type, e.message, e.params)
  rescue RxMarshal::FormatError => e
    Protocol.err_response(id, 'FormatError', e.message)
  rescue StandardError => e
    Protocol.err_response(id, 'InternalError', "#{e.class}: #{e.message}")
    warn e.backtrace.join("\n") if ENV['RXDATA_DRIVER_DEBUG']
  end
  ctx.shutdown
end

def run
  ctx = Commands::Context.new

  while (line = $stdin.gets)
    line = line.strip
    next if line.empty?

    break if handle_request_line(ctx, line)
  end
end

if $PROGRAM_NAME == __FILE__
  begin
    run
  rescue Interrupt, Errno::EPIPE
    exit 0
  end
end
