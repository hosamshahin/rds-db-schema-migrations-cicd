'use strict'

import { KnexClient } from "./knex-client"

const knexClient = new KnexClient()

export async function handler(event: any): Promise<any> {
  console.info("EVENT\n" + JSON.stringify(event, null, 2))
  try {
    await knexClient.dbSetup()
    await knexClient.migrate()

    return {
      StatusCode: 200,
      Message: "Successfully run migration command"
    }
  } catch (error) {
    console.error(error)
    return {
      StatusCode: 500,
      Message: "Could not run migration command.",
      Error: error
    }
  }
}
