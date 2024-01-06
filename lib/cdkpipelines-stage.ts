import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { RdsDbSchemaMigrationsLambda } from './lambda-construct';
import { Database } from './database-construct';

/**
 * Main stack to combine other nested stacks (CDK Constructs)
 */
export class InfraStack extends cdk.Stack {
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
    const database = new Database(this, 'Database', id)
    const service = new RdsDbSchemaMigrationsLambda(this, 'WebService', {
      dbCredentialsSecretName: database.secretName,
      dbCredentialsSecretArn: database.secretArn,
      vpc: database.vpc,
      securityGroup: database.securityGroup,
      defaultDBName: database.defaultDBName,
      crossAccount,
      stageName,
      devAccountId
    });

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

  constructor(scope: Construct, id: string, crossAccount: boolean, devAccountId?: string, props?: cdk.StageProps) {
    super(scope, id, props);

    const mainStack = new InfraStack(this, 'PrimaryStack', crossAccount, id, devAccountId)

    this.lambdaFunctionName = mainStack.lambdaFunctionName;
    this.crossAccountLambdaInvokeRoleName = mainStack.crossAccountLambdaInvokeRoleName;
  }
}