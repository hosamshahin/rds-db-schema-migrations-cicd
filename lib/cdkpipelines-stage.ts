import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { RdsDbSchemaMigrationsLambda } from './lambda-stack';
import { DatabaseStack } from './database-stack';

/**
 * Main stack to combine other nested stacks (CDK Constructs)
 */
export class PrimaryInfraStack extends cdk.Stack {
  public readonly lambdaFunctionName: string;
  public readonly crossAccountLambdaInvokeRoleName: string;

  constructor(
    scope: Construct,
    id: string,
    crossAccount: boolean,
    stageName: string,
    devAccountId?: string,
    props?: cdk.StackProps
  ) {
    super(scope, id, props);
    const database = new DatabaseStack(this, 'DatabaseConstruct', id)
    const service = new RdsDbSchemaMigrationsLambda(
      this,
      'WebServiceConstruct',
      {
        dbCredentialsSecretName: database.secretName,
        dbCredentialsSecretArn: database.secretArn,
        vpc: database.vpc,
        securityGroup: database.securityGroupOutput,
        defaultDBName: database.defaultDBName,
        crossAccount,
        stageName,
        devAccountId

      }

    );
    this.lambdaFunctionName = service.lambdaFunctionName;
    this.crossAccountLambdaInvokeRoleName = service.crossAccountLambdaInvokeRoleName;
  }
}

/**
 * Deployable unit of web service app
 */
export class CdkpipelinesStage extends cdk.Stage {
  public readonly lambdaFunctionName: string;
  public readonly crossAccountLambdaInvokeRoleName: string;

  constructor(
    scope: Construct,
    id: string,
    crossAccount: boolean,
    devAccountId?: string,
    props?: cdk.StageProps
  ) {
    super(scope, id, props);

    const mainStack = new PrimaryInfraStack(this, 'PrimaryStack', crossAccount, id, devAccountId)

    this.lambdaFunctionName = mainStack.lambdaFunctionName;
    this.crossAccountLambdaInvokeRoleName = mainStack.crossAccountLambdaInvokeRoleName;
  }
}