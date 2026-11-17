import type { FastifyReply, FastifyRequest } from 'fastify';
import { AdminReasonSchema } from '@skybook/shared';
import { flightService } from './flight.service.js';
import {
  AdminFlightListQuerySchema,
  AutocompleteQuerySchema,
  CreateAircraftTypeSchema,
  CreateAirportSchema,
  CreateCitySchema,
  CreateFlightSchema,
  FlightIdParamSchema,
  FlightSearchParamsSchema,
  UpdateAirportSchema,
  UpdateCitySchema,
  UpdateFlightSchema,
  UpdateSeatLayoutsSchema
} from './flight.types.js';

function adminMeta(request: FastifyRequest) {
  return {
    adminUserId: request.authUser!.userId,
    ipAddress: request.ip,
    requestId: request.id
  };
}

export class FlightController {
  // Public / Passenger endpoints (FR-PAX-006..012)
  async autocomplete(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
    const query = AutocompleteQuerySchema.parse(request.query);
    const items = await flightService.autocomplete(query.q);
    return reply.status(200).send({ data: items });
  }

  async search(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
    const params = FlightSearchParamsSchema.parse(request.query);
    const result = await flightService.searchFlights(params);
    return reply.status(200).send(result);
  }

  async getFlight(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
    const { id } = FlightIdParamSchema.parse(request.params);
    const flight = await flightService.getFlightDetails(id, false);
    return reply.status(200).send(flight);
  }

  async getSeatMap(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
    const { id } = FlightIdParamSchema.parse(request.params);
    const seatMap = await flightService.getSeatMap(id);
    return reply.status(200).send(seatMap);
  }

  // Admin endpoints (FR-ADM-004..010)
  async adminListFlights(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
    const query = AdminFlightListQuerySchema.parse(request.query);
    const result = await flightService.listAdminFlights(query);
    return reply.status(200).send(result);
  }

  async adminCreateFlight(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
    const body = CreateFlightSchema.parse(request.body);
    const flight = await flightService.createFlight(body, adminMeta(request));
    return reply.status(201).send(flight);
  }

  async adminUpdateFlight(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
    const { id } = FlightIdParamSchema.parse(request.params);
    const body = UpdateFlightSchema.parse(request.body);
    const flight = await flightService.updateFlight(id, body, adminMeta(request));
    return reply.status(200).send(flight);
  }

  async adminPublishFlight(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
    const { id } = FlightIdParamSchema.parse(request.params);
    const { reason } = AdminReasonSchema.parse(request.body);
    const flight = await flightService.publishFlight(id, reason, adminMeta(request));
    return reply.status(200).send(flight);
  }

  async adminCancelFlight(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
    const { id } = FlightIdParamSchema.parse(request.params);
    const { reason } = AdminReasonSchema.parse(request.body);
    const flight = await flightService.cancelFlight(id, reason, adminMeta(request));
    return reply.status(200).send(flight);
  }

  async adminListCities(_request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
    const cities = await flightService.listCities();
    return reply.status(200).send({ data: cities });
  }

  async adminCreateCity(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
    const body = CreateCitySchema.parse(request.body);
    const city = await flightService.createCity(body, adminMeta(request));
    return reply.status(201).send(city);
  }

  async adminUpdateCity(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
    const { id } = FlightIdParamSchema.parse(request.params);
    const body = UpdateCitySchema.parse(request.body);
    const city = await flightService.updateCity(id, body, adminMeta(request));
    return reply.status(200).send(city);
  }

  async adminCreateAirport(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
    const body = CreateAirportSchema.parse(request.body);
    const airport = await flightService.createAirport(body, adminMeta(request));
    return reply.status(201).send(airport);
  }

  async adminUpdateAirport(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
    const { id } = FlightIdParamSchema.parse(request.params);
    const body = UpdateAirportSchema.parse(request.body);
    const airport = await flightService.updateAirport(id, body, adminMeta(request));
    return reply.status(200).send(airport);
  }

  async adminListAircraftTypes(_request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
    const items = await flightService.listAircraftTypes();
    return reply.status(200).send({ data: items });
  }

  async adminCreateAircraftType(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<FastifyReply> {
    const body = CreateAircraftTypeSchema.parse(request.body);
    const item = await flightService.createAircraftType(body, adminMeta(request));
    return reply.status(201).send(item);
  }

  async adminUpdateAircraftLayouts(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<FastifyReply> {
    const { id } = FlightIdParamSchema.parse(request.params);
    const body = UpdateSeatLayoutsSchema.parse(request.body);
    const item = await flightService.updateAircraftSeatLayouts(id, body, adminMeta(request));
    return reply.status(200).send(item);
  }
}

export const flightController = new FlightController();