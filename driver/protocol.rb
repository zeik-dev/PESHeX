# =============================================================================
# protocol.rb — Errores y helpers del protocolo JSON por linea del driver.
#
# Peticion:  {"id":N,"cmd":"...", ...params}
# Respuesta: {"id":N,"ok":true,"revision":R,...} o
#            {"id":N,"ok":false,"error":{"type":"...","message":"...","params":{...}}}
#
# Las vistas semanticas nuevas devuelven CODIGOS + params (la UI los traduce);
# `message` queda como texto de respaldo para depuracion y para el modo Avanzado.
# =============================================================================

require 'json'

class DriverError < StandardError
  attr_reader :error_type, :params

  def initialize(error_type, message, params = nil)
    super(message)
    @error_type = error_type
    @params = params
  end
end

module Protocol
  module_function

  def write_json(obj)
    $stdout.write(JSON.generate(obj))
    $stdout.write("\n")
  end

  def ok_response(id, data = {}, revision: nil)
    body = { id: id, ok: true }
    body[:revision] = revision unless revision.nil?
    write_json(body.merge(data))
  end

  def err_response(id, type, message, params = nil)
    error = { type: type, message: message }
    error[:params] = params if params
    write_json({ id: id, ok: false, error: error })
  end
end
